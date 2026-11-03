import { Router, type Request, type Response } from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { getDbPool } from "../db/connection.js";
import { getRedisClient } from "../redis/client.js";
import {
  deriveCredentialKey,
  encryptRtspUrl,
  decryptRtspUrl,
  extractRtspHost,
} from "../crypto/credentials.js";
import { authenticateToken, requireRole } from "../auth/middleware.js";
import { syncCameraToMediaMTX } from "../mediamtx/client.js";
import {
  getClockOffset,
  getCapabilities,
  getProfiles,
  getStreamUri,
  getImagingSettings,
  setImagingSettings,
  continuousMove,
  stopMove,
  rebootCamera,
} from "../onvif/client.js";
import { runWsDiscovery, type DiscoveredCamera } from "../onvif/discovery.js";

export const onvifRouter = Router();

// Helper to encrypt generic string with AES-256-GCM using credential key
function encryptString(val: string): Buffer {
  const key = deriveCredentialKey();
  return encryptRtspUrl(val, key);
}

// Helper to decrypt generic string with AES-256-GCM using credential key
function decryptString(buf: Buffer): string {
  const key = deriveCredentialKey();
  return decryptRtspUrl(buf, key);
}

/**
 * GET /api/onvif/discover
 * Scans local network for ONVIF cameras and returns matching devices.
 */
onvifRouter.get("/discover", authenticateToken, async (_req: Request, res: Response): Promise<void> => {
  try {
    // Touch trigger file in data directory so host agent scans physical switch
    try {
      const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
      const triggerPath = path.resolve(dataDir, "onvif_discover_trigger.json");
      fs.writeFileSync(triggerPath, JSON.stringify({ timestamp: Date.now() }), "utf8");
    } catch {}

    const discovered = await runWsDiscovery(2500);

    // Cross-check with registered cameras in DB
    const pool = getDbPool();
    const [existingRows] = (await pool.query("SELECT id, name, rtsp_host, onvif_xaddr FROM cameras")) as any[];

    const result = discovered.map((d: DiscoveredCamera) => {
      const existing = existingRows.find((r: any) => {
        if (r.onvif_xaddr && r.onvif_xaddr.includes(d.ip)) return true;
        if (r.rtsp_host && r.rtsp_host.includes(d.ip)) return true;
        return false;
      });

      return {
        ...d,
        isAlreadyAdded: Boolean(existing),
        existingCameraId: existing ? existing.id : null,
        existingCameraName: existing ? existing.name : null,
      };
    });

    res.json({ devices: result });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to run ONVIF discovery", message: err.message });
  }
});

const verifySchema = z.object({
  xaddr: z.string().url(),
  username: z.string().max(64).optional(),
  password: z.string().max(128).optional(),
});

/**
 * POST /api/onvif/verify
 * Tests ONVIF connection and credentials ONCE (Anti-Lockout Protection).
 */
onvifRouter.post("/verify", authenticateToken, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const parseResult = verifySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.issues });
    return;
  }

  const { xaddr, username, password } = parseResult.data;

  try {
    const offset = await getClockOffset(xaddr);
    const caps = await getCapabilities(xaddr, username, password, offset);

    let profiles: any[] = [];
    let streamUri: string | null = null;

    if (caps.media) {
      profiles = await getProfiles(caps.media, username, password, offset);
      if (profiles.length > 0) {
        streamUri = await getStreamUri(caps.media, profiles[0].token, username, password, offset);
      }
    }

    res.json({
      success: true,
      hasMedia: Boolean(caps.media),
      hasImaging: Boolean(caps.imaging),
      hasPtz: Boolean(caps.ptz),
      hasEvents: Boolean(caps.events),
      profiles,
      primaryStreamUri: streamUri,
    });
  } catch (err: any) {
    res.status(401).json({
      success: false,
      error: "Verifikasi kredensial gagal atau perangkat tidak merespons",
      message: err.message,
    });
  }
});

const addBulkSchema = z.object({
  cameras: z.array(z.object({
    name: z.string().min(1).max(100),
    xaddr: z.string().url(),
    username: z.string().max(64).optional(),
    password: z.string().max(128).optional(),
    profileToken: z.string().optional(),
    preferred_encoder: z.enum(["av1_nvenc", "hevc_nvenc"]).optional().default("av1_nvenc"),
    target_vmaf: z.number().min(60).max(98).optional().default(85),
  })).min(1),
});

/**
 * POST /api/onvif/add-bulk
 * Automatically provisions verified ONVIF cameras into Quantis.
 */
onvifRouter.post("/add-bulk", authenticateToken, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const parseResult = addBulkSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.issues });
    return;
  }

  const pool = getDbPool();
  const redis = getRedisClient();
  const addedIds: number[] = [];

  for (const cam of parseResult.data.cameras) {
    try {
      const offset = await getClockOffset(cam.xaddr);
      const caps = await getCapabilities(cam.xaddr, cam.username, cam.password, offset);

      let streamUri: string | null = null;
      if (caps.media) {
        const profiles = await getProfiles(caps.media, cam.username, cam.password, offset);
        const selectedToken = cam.profileToken || profiles[0]?.token;
        if (selectedToken) {
          streamUri = await getStreamUri(caps.media, selectedToken, cam.username, cam.password, offset);
        }
      }

      if (!streamUri) {
        // Fallback default RTSP pattern if stream URI is withheld
        const u = new URL(cam.xaddr);
        const safePass = cam.password ? encodeURIComponent(cam.password) : "";
        const authPart = cam.username ? `${encodeURIComponent(cam.username)}:${safePass}@` : "";
        streamUri = `rtsp://${authPart}${u.hostname}:554`;
      }

      const rtspHost = extractRtspHost(streamUri);
      const rtspEnc = encryptString(streamUri);
      const passEnc = cam.password ? encryptString(cam.password) : null;
      const capabilitiesJson = JSON.stringify({
        ptz: Boolean(caps.ptz),
        imaging: Boolean(caps.imaging),
        events: Boolean(caps.events),
        mediaUrl: caps.media,
        imagingUrl: caps.imaging,
        ptzUrl: caps.ptz,
      });

      const defaultYolo = JSON.stringify({
        preset_groups: {},
        custom_class_ids: [],
        resolved_active_ids: [0, 1, 2, 3, 5, 7, 14, 15, 16],
      });

      const [insertRes] = (await pool.query(
        `INSERT INTO cameras (
          name, rtsp_url_enc, rtsp_host, onvif_xaddr, onvif_user, onvif_pass_enc, onvif_capabilities,
          enabled, active_yolo_classes, confidence_threshold, target_vmaf, target_vmaf_p25,
          preferred_encoder, smart_ai_sampling, split_count, slice_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0.35, ?, ?, ?, 1, 1, 0)`,
        [
          cam.name,
          rtspEnc,
          rtspHost,
          cam.xaddr,
          cam.username || null,
          passEnc,
          capabilitiesJson,
          defaultYolo,
          cam.target_vmaf,
          cam.target_vmaf - 4,
          cam.preferred_encoder,
        ]
      )) as any[];

      const newId = insertRes.insertId;
      addedIds.push(newId);

      // Sync to Redis and MediaMTX
      await redis.set(`cam:${newId}:rtsp_url`, streamUri);
      await redis.set(`cam:${newId}:classes`, JSON.stringify([0, 1, 2, 3, 5, 7, 14, 15, 16]));
      await redis.set(`cam:${newId}:conf`, "0.35");
      await redis.set(`cam:${newId}:rev`, "1");
      await syncCameraToMediaMTX(newId);
      await redis.publish("camera:changed", JSON.stringify({ camera_id: newId, action: "added" }));
    } catch (err: any) {
      console.error(`[ONVIF] Failed to add camera ${cam.name}:`, err.message);
    }
  }

  res.json({ success: true, count: addedIds.length, addedIds });
});

/**
 * GET /api/onvif/camera/:id/controls
 * Returns active capabilities and current imaging/PTZ settings for a camera.
 */
onvifRouter.get("/camera/:id/controls", authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const camId = parseInt(String(req.params.id), 10);
  if (isNaN(camId)) {
    res.status(400).json({ error: "Invalid camera ID" });
    return;
  }

  const pool = getDbPool();
  const [rows] = (await pool.query(
    "SELECT id, name, onvif_xaddr, onvif_user, onvif_pass_enc, onvif_capabilities FROM cameras WHERE id = ?",
    [camId]
  )) as any[];

  if (rows.length === 0) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const cam = rows[0];
  if (!cam.onvif_xaddr) {
    res.json({ supported: false, message: "Kamera ini tidak memiliki konfigurasi ONVIF" });
    return;
  }

  const password = cam.onvif_pass_enc ? decryptString(cam.onvif_pass_enc) : "";
  const username = cam.onvif_user || "";

  try {
    const offset = await getClockOffset(cam.onvif_xaddr);
    const caps = await getCapabilities(cam.onvif_xaddr, username, password, offset);

    let imagingSettings: any = null;
    let profiles: any[] = [];

    if (caps.media) {
      profiles = await getProfiles(caps.media, username, password, offset);
    }

    if (caps.imaging && profiles.length > 0) {
      const sourceToken = profiles[0].videoSourceToken || "VideoSource_1";
      imagingSettings = await getImagingSettings(caps.imaging, sourceToken, username, password, offset);
    }

    res.json({
      supported: true,
      hasPtz: Boolean(caps.ptz),
      hasImaging: Boolean(caps.imaging),
      profiles,
      imagingSettings,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read ONVIF controls", message: err.message });
  }
});

const ptzSchema = z.object({
  action: z.enum(["move", "stop"]),
  x: z.number().min(-1).max(1).optional(),
  y: z.number().min(-1).max(1).optional(),
  zoom: z.number().min(-1).max(1).optional(),
});

/**
 * POST /api/onvif/camera/:id/ptz
 * Executes continuous Pan/Tilt/Zoom movement or stops movement.
 */
onvifRouter.post("/camera/:id/ptz", authenticateToken, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const camId = parseInt(String(req.params.id), 10);
  const parseResult = ptzSchema.safeParse(req.body);
  if (isNaN(camId) || !parseResult.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }

  const pool = getDbPool();
  const [rows] = (await pool.query(
    "SELECT onvif_xaddr, onvif_user, onvif_pass_enc FROM cameras WHERE id = ?",
    [camId]
  )) as any[];

  if (rows.length === 0 || !rows[0].onvif_xaddr) {
    res.status(404).json({ error: "Camera or ONVIF endpoint not found" });
    return;
  }

  const cam = rows[0];
  const password = cam.onvif_pass_enc ? decryptString(cam.onvif_pass_enc) : "";
  const username = cam.onvif_user || "";

  try {
    const offset = await getClockOffset(cam.onvif_xaddr);
    const caps = await getCapabilities(cam.onvif_xaddr, username, password, offset);
    if (!caps.ptz || !caps.media) {
      res.status(400).json({ error: "PTZ not supported on this camera" });
      return;
    }

    const profiles = await getProfiles(caps.media, username, password, offset);
    const profileToken = profiles[0]?.token || "Profile_1";

    const { action, x, y, zoom } = parseResult.data;
    if (action === "move") {
      await continuousMove(caps.ptz, profileToken, { x, y, zoom }, username, password, offset);
    } else {
      await stopMove(caps.ptz, profileToken, username, password, offset);
    }

    res.json({ success: true, action });
  } catch (err: any) {
    res.status(500).json({ error: "PTZ operation failed", message: err.message });
  }
});

const imagingSchema = z.object({
  irCutFilter: z.enum(["AUTO", "ON", "OFF"]).optional(),
  brightness: z.number().min(0).max(100).optional(),
  contrast: z.number().min(0).max(100).optional(),
  colorSaturation: z.number().min(0).max(100).optional(),
  sharpness: z.number().min(0).max(100).optional(),
  wdr: z.boolean().optional(),
});

/**
 * POST /api/onvif/camera/:id/imaging
 * Sets Day/Night mode (IR-Cut filter), Brightness, Contrast, etc.
 */
onvifRouter.post("/camera/:id/imaging", authenticateToken, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const camId = parseInt(String(req.params.id), 10);
  const parseResult = imagingSchema.safeParse(req.body);
  if (isNaN(camId) || !parseResult.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }

  const pool = getDbPool();
  const [rows] = (await pool.query(
    "SELECT onvif_xaddr, onvif_user, onvif_pass_enc FROM cameras WHERE id = ?",
    [camId]
  )) as any[];

  if (rows.length === 0 || !rows[0].onvif_xaddr) {
    res.status(404).json({ error: "Camera or ONVIF endpoint not found" });
    return;
  }

  const cam = rows[0];
  const password = cam.onvif_pass_enc ? decryptString(cam.onvif_pass_enc) : "";
  const username = cam.onvif_user || "";

  try {
    const offset = await getClockOffset(cam.onvif_xaddr);
    const caps = await getCapabilities(cam.onvif_xaddr, username, password, offset);
    if (!caps.imaging || !caps.media) {
      res.status(400).json({ error: "Imaging not supported on this camera" });
      return;
    }

    const profiles = await getProfiles(caps.media, username, password, offset);
    const videoSourceToken = profiles[0]?.videoSourceToken || "VideoSource_1";

    const ok = await setImagingSettings(caps.imaging, videoSourceToken, parseResult.data, username, password, offset);
    res.json({ success: ok, updated: parseResult.data });
  } catch (err: any) {
    res.status(500).json({ error: "Imaging operation failed", message: err.message });
  }
});

/**
 * POST /api/onvif/camera/:id/reboot
 * Reboots the camera hardware via ONVIF.
 */
onvifRouter.post("/camera/:id/reboot", authenticateToken, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const camId = parseInt(String(req.params.id), 10);
  if (isNaN(camId)) {
    res.status(400).json({ error: "Invalid camera ID" });
    return;
  }

  const pool = getDbPool();
  const [rows] = (await pool.query(
    "SELECT onvif_xaddr, onvif_user, onvif_pass_enc FROM cameras WHERE id = ?",
    [camId]
  )) as any[];

  if (rows.length === 0 || !rows[0].onvif_xaddr) {
    res.status(404).json({ error: "Camera or ONVIF endpoint not found" });
    return;
  }

  const cam = rows[0];
  const password = cam.onvif_pass_enc ? decryptString(cam.onvif_pass_enc) : "";
  const username = cam.onvif_user || "";

  try {
    const offset = await getClockOffset(cam.onvif_xaddr);
    const ok = await rebootCamera(cam.onvif_xaddr, username, password, offset);
    res.json({ success: ok, message: "Perintah reboot berhasil dikirim ke kamera" });
  } catch (err: any) {
    res.status(500).json({ error: "Reboot failed", message: err.message });
  }
});
