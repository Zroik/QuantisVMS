import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getDbPool } from "../db/connection.js";
import { getRedisClient } from "../redis/client.js";
import {
  deriveCredentialKey,
  encryptRtspUrl,
  decryptRtspUrl,
  encodeEncryptedRtspForRedis,
  maskRtspUrl,
  extractRtspHost,
} from "../crypto/credentials.js";
import {
  COCO_CLASSES,
  PRESET_GROUPS,
  DEFAULT_ACTIVE_CLASS_IDS,
  resolveActiveClassIds,
} from "../yolo/classes.js";
import { authenticateToken, requireRole } from "../auth/middleware.js";
import { syncCameraToMediaMTX, removeCameraFromMediaMTX } from "../mediamtx/client.js";

export const camerasRouter = Router();

// All camera routes require authentication
camerasRouter.use(authenticateToken);

const createCameraSchema = z.object({
  name: z.string().min(1).max(100),
  rtsp_url: z.string().regex(/^rtsps?:\/\//, "URL must start with rtsp://"),
  enabled: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)).optional().default(true),
  confidence_threshold: z.number().min(0.05).max(1.0).optional().default(0.35),
  target_vmaf: z.number().min(50).max(100).optional().default(85.0),
  target_vmaf_p25: z.number().min(40).max(100).optional().default(81.0),
  preferred_encoder: z.enum(["hevc_nvenc", "av1_nvenc", "libx265", "libsvtav1"]).nullable().optional().default("av1_nvenc"),
  smart_ai_sampling: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)).optional().default(true),
  split_count: z.number().int().min(1).max(4).optional().default(1),
  preset_groups: z.union([z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
  custom_class_ids: z.array(z.number()).optional(),
  onvif_xaddr: z.string().url().optional(),
  onvif_user: z.string().max(64).optional(),
  onvif_pass: z.string().max(128).optional(),
});

const patchCameraSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  rtsp_url: z.string().regex(/^rtsps?:\/\//, "URL must start with rtsp://").optional(),
  enabled: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)).optional(),
  confidence_threshold: z.number().min(0.05).max(1.0).optional(),
  target_vmaf: z.number().min(50).max(100).optional(),
  target_vmaf_p25: z.number().min(40).max(100).optional(),
  preferred_encoder: z.enum(["hevc_nvenc", "av1_nvenc", "libx265", "libsvtav1"]).nullable().optional(),
  smart_ai_sampling: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)).optional(),
  split_count: z.number().int().min(1).max(4).optional(),
  onvif_xaddr: z.string().url().nullable().optional(),
  onvif_user: z.string().max(64).nullable().optional(),
  onvif_pass: z.string().max(128).nullable().optional(),
  onvif_capabilities: z.any().optional(),
});

const toggleClassesSchema = z.object({
  preset_groups: z.union([z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
  custom_class_ids: z.array(z.number()).optional(),
  active_classes: z.array(z.number()).optional(),
  active_class_ids: z.array(z.number()).optional(),
  confidence_threshold: z.number().min(0.05).max(1.0).optional(),
});

const compressionPolicySchema = z.object({
  target_vmaf: z.number().min(50).max(100).optional(),
  target_vmaf_p25: z.number().min(40).max(100).optional(),
  preferred_encoder: z.enum(["hevc_nvenc", "av1_nvenc", "libx265", "libsvtav1"]).nullable().optional(),
  smart_ai_sampling: z.boolean().optional(),
});

/**
 * Format DB row for public response with masked RTSP URL (Spec §10, Gate G3.3).
 */
function formatCameraResponse(row: any): any {
  let maskedUrl = "rtsp://***:***@" + row.rtsp_host;
  try {
    if (row.rtsp_url_enc) {
      const key = deriveCredentialKey();
      const plain = decryptRtspUrl(Buffer.from(row.rtsp_url_enc), key);
      maskedUrl = maskRtspUrl(plain);
    }
  } catch {
    // Keep fallback maskedUrl
  }

  let activeClasses = row.active_yolo_classes;
  if (typeof activeClasses === "string") {
    try {
      activeClasses = JSON.parse(activeClasses);
    } catch {
      // keep as is
    }
  }

  let onvifCaps = null;
  if (row.onvif_capabilities) {
    if (typeof row.onvif_capabilities === "string") {
      try {
        onvifCaps = JSON.parse(row.onvif_capabilities);
      } catch {
        onvifCaps = null;
      }
    } else {
      onvifCaps = row.onvif_capabilities;
    }
  }

  return {
    id: row.id,
    name: row.name,
    rtsp_url: maskedUrl,
    rtsp_host: row.rtsp_host,
    enabled: Boolean(row.enabled),
    active_yolo_classes: activeClasses,
    confidence_threshold: Number(row.confidence_threshold),
    target_vmaf: Number(row.target_vmaf),
    target_vmaf_p25: Number(row.target_vmaf_p25),
    preferred_encoder: row.preferred_encoder,
    smart_ai_sampling: Boolean(row.smart_ai_sampling),
    split_count: Number(row.split_count || 1),
    slice_index: Number(row.slice_index || 0),
    parent_camera_id: row.parent_camera_id ? Number(row.parent_camera_id) : null,
    stream_path: `cam${row.parent_camera_id || row.id}`,
    static_cq_cache: row.static_cq_cache,
    static_cq_cached_at: row.static_cq_cached_at,
    onvif_xaddr: row.onvif_xaddr || null,
    onvif_user: row.onvif_user || null,
    onvif_capabilities: onvifCaps,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Synchronizes multi-sensor camera slice sub-records based on vertical height splits (Spec §6 & §8).
 * E.g., for V380 Pro 2304x2592 with splitCount=2:
 *  - Parent camera: Sensor 1 (Atas)
 *  - Child camera: Sensor 2 (Bawah)
 */
export async function syncCameraSlices(
  pool: any,
  redis: any,
  parentId: number,
  splitCount: number,
  baseName?: string
) {
  const [parentRows] = (await pool.query("SELECT * FROM cameras WHERE id = ?", [parentId])) as any[];
  if (parentRows.length === 0) return;
  const parent = parentRows[0];

  const actualParentId = parent.parent_camera_id || parentId;
  const count = Math.max(1, Math.min(4, Math.floor(splitCount)));
  const rawName = baseName || parent.name;
  const cleanName = rawName.replace(/\s*\(Sensor.*?\)$/i, "").trim();

  if (count <= 1) {
    // Revert to 1 sensor
    await pool.query("UPDATE cameras SET split_count = 1, slice_index = 0, name = ? WHERE id = ?", [cleanName, actualParentId]);
    const [children] = (await pool.query("SELECT id FROM cameras WHERE parent_camera_id = ?", [actualParentId])) as any[];
    for (const child of children) {
      await pool.query("DELETE FROM cameras WHERE id = ?", [child.id]);
      try {
        await removeCameraFromMediaMTX(child.id);
        await redis.del(`cam:${child.id}:rtsp_url`, `cam:${child.id}:classes`, `cam:${child.id}:conf`, `cam:${child.id}:rev`);
        await redis.publish("camera:changed", JSON.stringify({ camera_id: child.id, action: "removed" }));
      } catch {}
    }
    return;
  }

  // Count > 1 (e.g. 2, 3, 4)
  const slice0Name = `${cleanName} (Sensor 1${count === 2 ? ' - Atas' : ''})`;
  await pool.query("UPDATE cameras SET split_count = ?, slice_index = 0, name = ? WHERE id = ?", [count, slice0Name, actualParentId]);

  const parentClassesStr = typeof parent.active_yolo_classes === "string"
    ? parent.active_yolo_classes
    : JSON.stringify(parent.active_yolo_classes || {});

  for (let i = 1; i < count; i++) {
    const sliceLabel = (count === 2 && i === 1) ? "Sensor 2 - Bawah" : `Sensor ${i + 1}`;
    const childName = `${cleanName} (${sliceLabel})`;

    const [existingChild] = (await pool.query(
      "SELECT id FROM cameras WHERE parent_camera_id = ? AND slice_index = ?",
      [actualParentId, i]
    )) as any[];

    let childId: number;
    if (existingChild.length > 0) {
      childId = existingChild[0].id;
      await pool.query(
        `UPDATE cameras SET
          name = ?, rtsp_url_enc = ?, rtsp_host = ?, enabled = ?,
          active_yolo_classes = ?, confidence_threshold = ?, target_vmaf = ?, target_vmaf_p25 = ?,
          preferred_encoder = ?, smart_ai_sampling = ?, split_count = ?, slice_index = ?
         WHERE id = ?`,
        [
          childName, parent.rtsp_url_enc, parent.rtsp_host, parent.enabled,
          parentClassesStr, parent.confidence_threshold, parent.target_vmaf, parent.target_vmaf_p25,
          parent.preferred_encoder, parent.smart_ai_sampling, count, i, childId
        ]
      );
    } else {
      const [insertRes] = (await pool.query(
        `INSERT INTO cameras (
          name, rtsp_url_enc, rtsp_host, enabled,
          active_yolo_classes, confidence_threshold, target_vmaf, target_vmaf_p25,
          preferred_encoder, smart_ai_sampling, split_count, slice_index, parent_camera_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          childName, parent.rtsp_url_enc, parent.rtsp_host, parent.enabled,
          parentClassesStr, parent.confidence_threshold, parent.target_vmaf, parent.target_vmaf_p25,
          parent.preferred_encoder, parent.smart_ai_sampling, count, i, actualParentId
        ]
      )) as any[];
      childId = insertRes.insertId;
    }

    try {
      const parentClasses = await redis.get(`cam:${actualParentId}:classes`);
      if (parentClasses) {
        await redis.set(`cam:${childId}:classes`, parentClasses);
      }
      const parentConf = await redis.get(`cam:${actualParentId}:conf`);
      if (parentConf) {
        await redis.set(`cam:${childId}:conf`, parentConf);
      }
      await redis.set(`cam:${childId}:rev`, "1");
      // Children are UI-only slices of the parent stream: do NOT create a
      // MediaMTX path or a plaintext Redis RTSP URL for them.
      await redis.publish("camera:changed", JSON.stringify({ camera_id: childId, action: "added", enabled: false }));
    } catch {}
  }

  // Remove any obsolete slices
  const [obsolete] = (await pool.query(
    "SELECT id FROM cameras WHERE parent_camera_id = ? AND slice_index >= ?",
    [actualParentId, count]
  )) as any[];
  for (const obs of obsolete) {
    await pool.query("DELETE FROM cameras WHERE id = ?", [obs.id]);
    try {
      await removeCameraFromMediaMTX(obs.id);
      await redis.del(`cam:${obs.id}:rtsp_url`, `cam:${obs.id}:classes`, `cam:${obs.id}:conf`, `cam:${obs.id}:rev`);
      await redis.publish("camera:changed", JSON.stringify({ camera_id: obs.id, action: "removed" }));
    } catch {}
  }
}

// GET /api/cameras
camerasRouter.get("/", async (_req: Request, res: Response): Promise<void> => {
  const pool = getDbPool();
  const [rows] = await pool.query<any[]>(
    "SELECT * FROM cameras ORDER BY id ASC"
  );
  res.json(rows.map(formatCameraResponse));
});

// POST /api/cameras
camerasRouter.post("/", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const parseResult = createCameraSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.issues });
    return;
  }

  const data = parseResult.data;
  const key = deriveCredentialKey();
  const encryptedBuf = encryptRtspUrl(data.rtsp_url, key);
  const host = extractRtspHost(data.rtsp_url);

  const resolvedIds = resolveActiveClassIds(data.preset_groups, data.custom_class_ids);
  const activePayload = {
    preset_groups: data.preset_groups || {},
    custom_class_ids: data.custom_class_ids || [],
    resolved_active_ids: resolvedIds.length > 0 ? resolvedIds : DEFAULT_ACTIVE_CLASS_IDS,
  };

  const onvifPassEnc = data.onvif_pass ? encryptRtspUrl(data.onvif_pass, key) : null;
  const splitCount = data.split_count || 1;
  const pool = getDbPool();
  const [result] = await pool.query<any>(
    `INSERT INTO cameras (
      name, rtsp_url_enc, rtsp_host, onvif_xaddr, onvif_user, onvif_pass_enc,
      enabled, active_yolo_classes,
      confidence_threshold, target_vmaf, target_vmaf_p25,
      preferred_encoder, smart_ai_sampling, split_count, slice_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      data.name,
      encryptedBuf,
      host,
      data.onvif_xaddr || null,
      data.onvif_user || null,
      onvifPassEnc,
      data.enabled ? 1 : 0,
      JSON.stringify(activePayload),
      data.confidence_threshold,
      data.target_vmaf,
      data.target_vmaf_p25,
      data.preferred_encoder,
      data.smart_ai_sampling ? 1 : 0,
      splitCount,
    ]
  );

  const cameraId = result.insertId;
  const cameraEnabled = Boolean(data.enabled);

  // Initialize Redis keys for camera (encrypted RTSP envelope only, never plaintext)
  const redis = getRedisClient();
  await redis.set(`cam:${cameraId}:classes`, JSON.stringify(activePayload.resolved_active_ids));
  await redis.set(`cam:${cameraId}:conf`, String(data.confidence_threshold));
  await redis.set(`cam:${cameraId}:rev`, "1");
  if (cameraEnabled) {
    await redis.set(`cam:${cameraId}:rtsp_url`, encodeEncryptedRtspForRedis(encryptedBuf));
  }

  // Sync slices if splitCount > 1
  if (splitCount > 1) {
    await syncCameraSlices(pool, redis, cameraId, splitCount, data.name);
  }

  const [createdRows] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [cameraId]);

  // Notify recorder and AI vision worker (masked indicator only, never plaintext credentials)
  await redis.publish(
    "camera:changed",
    JSON.stringify({
      camera_id: cameraId,
      action: "added",
      enabled: cameraEnabled,
      rtsp_url: cameraEnabled ? maskRtspUrl(data.rtsp_url) : undefined,
      rtsp_changed: cameraEnabled,
    })
  );

  const synced = cameraEnabled ? await syncCameraToMediaMTX(cameraId) : false;
  const response = formatCameraResponse(createdRows[0]);
  res.status(201).json(synced ? response : { ...response, warning: "MediaMTX path was not synced" });
});

// GET /api/cameras/:id
camerasRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid camera ID" });
    return;
  }

  const pool = getDbPool();
  const [rows] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [id]);
  if (rows.length === 0) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  res.json(formatCameraResponse(rows[0]));
});

// PATCH /api/cameras/:id
camerasRouter.patch("/:id", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid camera ID" });
    return;
  }

  const parseResult = patchCameraSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.issues });
    return;
  }

  const data = parseResult.data;
  const pool = getDbPool();

  const [existing] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [id]);
  if (existing.length === 0) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (data.name !== undefined) {
    updates.push("name = ?");
    params.push(data.name);
  }
  if (data.rtsp_url !== undefined) {
    const key = deriveCredentialKey();
    updates.push("rtsp_url_enc = ?");
    params.push(encryptRtspUrl(data.rtsp_url, key));
    updates.push("rtsp_host = ?");
    params.push(extractRtspHost(data.rtsp_url));
  }
  if (data.enabled !== undefined) {
    updates.push("enabled = ?");
    params.push(data.enabled ? 1 : 0);
  }
  if (data.confidence_threshold !== undefined) {
    updates.push("confidence_threshold = ?");
    params.push(data.confidence_threshold);
  }
  if (data.target_vmaf !== undefined) {
    updates.push("target_vmaf = ?");
    params.push(data.target_vmaf);
  }
  if (data.target_vmaf_p25 !== undefined) {
    updates.push("target_vmaf_p25 = ?");
    params.push(data.target_vmaf_p25);
  }
  if (data.preferred_encoder !== undefined) {
    updates.push("preferred_encoder = ?");
    params.push(data.preferred_encoder);
  }
  if (data.smart_ai_sampling !== undefined) {
    updates.push("smart_ai_sampling = ?");
    params.push(data.smart_ai_sampling ? 1 : 0);
  }
  if (data.split_count !== undefined) {
    updates.push("split_count = ?");
    params.push(data.split_count);
  }
  if (data.onvif_xaddr !== undefined) {
    updates.push("onvif_xaddr = ?");
    params.push(data.onvif_xaddr);
  }
  if (data.onvif_user !== undefined) {
    updates.push("onvif_user = ?");
    params.push(data.onvif_user);
  }
  if (data.onvif_pass !== undefined) {
    updates.push("onvif_pass_enc = ?");
    const key = deriveCredentialKey();
    params.push(data.onvif_pass ? encryptRtspUrl(data.onvif_pass, key) : null);
  }
  if (data.onvif_capabilities !== undefined) {
    updates.push("onvif_capabilities = ?");
    params.push(
      typeof data.onvif_capabilities === "string"
        ? data.onvif_capabilities
        : JSON.stringify(data.onvif_capabilities)
    );
  }

  if (updates.length > 0) {
    params.push(id);
    const updateSql = "UPDATE cameras SET " + updates.join(", ") + " WHERE id = ?";
    await pool.query(updateSql, params);
  }

  const redis = getRedisClient();
  if (data.split_count !== undefined || data.name !== undefined) {
    const parentId = existing[0].parent_camera_id || id;
    const splitCount = data.split_count !== undefined ? data.split_count : (existing[0].split_count || 1);
    await syncCameraSlices(pool, redis, parentId, splitCount, data.name);
  }

  const [updatedRows] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [id]);
  const wasEnabled = Boolean(existing[0]?.enabled);
  const nowEnabled = Boolean(updatedRows[0]?.enabled);
  const enabling = !wasEnabled && nowEnabled;
  const disabling = wasEnabled && !nowEnabled;

  // Keep Redis and MediaMTX in sync for the fields the recorder/AI/proxy read.
  if (data.confidence_threshold !== undefined) {
    await redis.set(`cam:${id}:conf`, String(data.confidence_threshold));
  }
  let synced = true;
  if (disabling) {
    await redis.del(`cam:${id}:rtsp_url`);
    await removeCameraFromMediaMTX(id);
  } else if (nowEnabled && (data.rtsp_url !== undefined || enabling)) {
    if (updatedRows[0]?.rtsp_url_enc) {
      await redis.set(
        `cam:${id}:rtsp_url`,
        encodeEncryptedRtspForRedis(Buffer.from(updatedRows[0].rtsp_url_enc))
      );
    }
    synced = await syncCameraToMediaMTX(id);
  } else if (!nowEnabled && data.rtsp_url !== undefined) {
    await redis.del(`cam:${id}:rtsp_url`);
  }

  // Notify recorder and AI vision worker for every meaningful change (never plaintext credentials).
  const streamChanged = data.rtsp_url !== undefined || enabling;
  await redis.publish(
    "camera:changed",
    JSON.stringify({
      camera_id: id,
      action: "updated",
      enabled: nowEnabled,
      rtsp_url: streamChanged ? (data.rtsp_url ? maskRtspUrl(data.rtsp_url) : "enabled") : undefined,
      rtsp_changed: streamChanged,
    })
  );

  const response = formatCameraResponse(updatedRows[0]);
  res.json(synced ? response : { ...response, warning: "MediaMTX path was not synced" });
});

// PUT /api/cameras/:id
camerasRouter.put("/:id", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid camera ID" });
    return;
  }

  const parseResult = patchCameraSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.issues });
    return;
  }

  const data = parseResult.data;
  const pool = getDbPool();
  const redis = getRedisClient();

  const [existing] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [id]);
  if (existing.length === 0) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (data.name !== undefined) {
    updates.push("name = ?");
    params.push(data.name);
  }
  if (data.rtsp_url !== undefined) {
    const key = deriveCredentialKey();
    const encryptedBuf = encryptRtspUrl(data.rtsp_url, key);
    const host = extractRtspHost(data.rtsp_url);
    updates.push("rtsp_url_enc = ?", "rtsp_host = ?");
    params.push(encryptedBuf, host);
  }
  if (data.enabled !== undefined) {
    updates.push("enabled = ?");
    params.push(data.enabled ? 1 : 0);
  }
  if (data.confidence_threshold !== undefined) {
    updates.push("confidence_threshold = ?");
    params.push(data.confidence_threshold);
    await redis.set(`cam:${id}:conf`, String(data.confidence_threshold));
  }
  if (data.target_vmaf !== undefined) {
    updates.push("target_vmaf = ?");
    params.push(data.target_vmaf);
  }
  if (data.target_vmaf_p25 !== undefined) {
    updates.push("target_vmaf_p25 = ?");
    params.push(data.target_vmaf_p25);
  }
  if (data.preferred_encoder !== undefined) {
    updates.push("preferred_encoder = ?");
    params.push(data.preferred_encoder);
  }
  if (data.smart_ai_sampling !== undefined) {
    updates.push("smart_ai_sampling = ?");
    params.push(data.smart_ai_sampling ? 1 : 0);
  }
  if (data.split_count !== undefined) {
    updates.push("split_count = ?");
    params.push(data.split_count);
  }
  if (data.onvif_xaddr !== undefined) {
    updates.push("onvif_xaddr = ?");
    params.push(data.onvif_xaddr);
  }
  if (data.onvif_user !== undefined) {
    updates.push("onvif_user = ?");
    params.push(data.onvif_user);
  }
  if (data.onvif_pass !== undefined) {
    updates.push("onvif_pass_enc = ?");
    const key = deriveCredentialKey();
    params.push(data.onvif_pass ? encryptRtspUrl(data.onvif_pass, key) : null);
  }
  if (data.onvif_capabilities !== undefined) {
    updates.push("onvif_capabilities = ?");
    params.push(
      typeof data.onvif_capabilities === "string"
        ? data.onvif_capabilities
        : JSON.stringify(data.onvif_capabilities)
    );
  }

  if (updates.length > 0) {
    params.push(id);
    await pool.query("UPDATE cameras SET " + updates.join(", ") + " WHERE id = ?", params);
  }

  if (data.split_count !== undefined || data.name !== undefined) {
    const parentId = existing[0].parent_camera_id || id;
    const splitCount = data.split_count !== undefined ? data.split_count : (existing[0].split_count || 1);
    await syncCameraSlices(pool, redis, parentId, splitCount, data.name);
  }

  const [updatedRows] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [id]);
  if (updatedRows.length === 0) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const wasEnabled = Boolean(existing[0]?.enabled);
  const nowEnabled = Boolean(updatedRows[0]?.enabled);
  const enabling = !wasEnabled && nowEnabled;
  const disabling = wasEnabled && !nowEnabled;

  let synced = true;
  if (disabling) {
    await redis.del(`cam:${id}:rtsp_url`);
    await removeCameraFromMediaMTX(id);
  } else if (nowEnabled && (data.rtsp_url !== undefined || enabling)) {
    if (updatedRows[0]?.rtsp_url_enc) {
      await redis.set(
        `cam:${id}:rtsp_url`,
        encodeEncryptedRtspForRedis(Buffer.from(updatedRows[0].rtsp_url_enc))
      );
    }
    synced = await syncCameraToMediaMTX(id);
  } else if (!nowEnabled && data.rtsp_url !== undefined) {
    await redis.del(`cam:${id}:rtsp_url`);
  }

  const streamChanged = data.rtsp_url !== undefined || enabling;
  if (data.rtsp_url !== undefined || data.enabled !== undefined || data.confidence_threshold !== undefined) {
    await redis.publish(
      "camera:changed",
      JSON.stringify({
        camera_id: id,
        action: "updated",
        enabled: nowEnabled,
        rtsp_url: streamChanged ? (data.rtsp_url ? maskRtspUrl(data.rtsp_url) : "enabled") : undefined,
        rtsp_changed: streamChanged,
      })
    );
  }

  const response = formatCameraResponse(updatedRows[0]);
  res.json(synced ? response : { ...response, warning: "MediaMTX path was not synced" });
});

// POST /api/cameras/:id/split (Trim / Separate camera into 2-4 vertical sensor slices)
camerasRouter.post("/:id/split", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const count = Number(req.body.split_count);
  if (!id || isNaN(id) || !count || count < 1 || count > 4) {
    res.status(400).json({ error: "Invalid camera ID or split_count (must be 1-4)" });
    return;
  }

  const pool = getDbPool();
  const redis = getRedisClient();
  const [existing] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [id]);
  if (existing.length === 0) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const parentId = existing[0].parent_camera_id || id;
  await syncCameraSlices(pool, redis, parentId, count);

  const [allCams] = await pool.query<any[]>("SELECT * FROM cameras ORDER BY id ASC");
  res.json({
    success: true,
    message: `Kamera berhasil dipotong menjadi ${count} sensor video terpisah.`,
    cameras: allCams.map(formatCameraResponse),
  });
});

// DELETE /api/cameras/:id
camerasRouter.delete("/:id", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid camera ID" });
    return;
  }

  const pool = getDbPool();

  // B-H7: Delete the camera and its child slices in one transaction so the
  // DB stays consistent with the Redis/MediaMTX cleanup that follows.
  let allIds: number[] = [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [parentRows] = await conn.query<any[]>(
      "SELECT id FROM cameras WHERE id = ? FOR UPDATE",
      [id]
    );
    if (parentRows.length === 0) {
      await conn.rollback();
      res.status(404).json({ error: "Camera not found" });
      return;
    }
    const [children] = await conn.query<any[]>(
      "SELECT id FROM cameras WHERE parent_camera_id = ?",
      [id]
    );
    allIds = [id, ...children.map((c) => Number(c.id))];
    if (children.length > 0) {
      await conn.query("DELETE FROM cameras WHERE parent_camera_id = ?", [id]);
    }
    await conn.query("DELETE FROM cameras WHERE id = ?", [id]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Clean up Redis keys and MediaMTX for parent and all child cameras
  const redis = getRedisClient();
  for (const cid of allIds) {
    await redis.del(`cam:${cid}:classes`, `cam:${cid}:conf`, `cam:${cid}:rev`, `cam:${cid}:rtsp_url`);
    await redis.publish(
      "camera:changed",
      JSON.stringify({
        camera_id: cid,
        action: "removed",
      })
    );
    await removeCameraFromMediaMTX(cid);
  }

  res.json({ ok: true, deleted_ids: allIds });
});

// PUT /api/cameras/:id/classes (Gate G3.4: Dynamic Class Toggle)
camerasRouter.put("/:id/classes", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid camera ID" });
    return;
  }

  const parseResult = toggleClassesSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.issues });
    return;
  }

  // F-C1: Support active_classes, active_class_ids, custom_class_ids, and preset_groups
  const { preset_groups, custom_class_ids, active_classes, active_class_ids, confidence_threshold } = parseResult.data;
  const rawCustomIds = active_class_ids ?? active_classes ?? custom_class_ids ?? [];

  // Gate G3.4: Validate class IDs are strictly within [0, 79]
  for (const cid of rawCustomIds) {
    if (!Number.isInteger(cid) || cid < 0 || cid > 79) {
      res.status(400).json({ error: `Invalid class id ${cid}: must be an integer between 0 and 79` });
      return;
    }
  }

  const pool = getDbPool();
  const [rows] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [id]);
  if (rows.length === 0) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  const currentCam = rows[0];
  const conf = confidence_threshold ?? Number(currentCam.confidence_threshold);

  // Recompute active IDs from preset groups union custom classes
  const resolvedActiveIds = resolveActiveClassIds(preset_groups, rawCustomIds);

  const activePayload = {
    preset_groups: preset_groups || {},
    custom_class_ids: rawCustomIds,
    resolved_active_ids: resolvedActiveIds,
  };

  // Update DB
  await pool.query(
    "UPDATE cameras SET active_yolo_classes = ?, confidence_threshold = ? WHERE id = ?",
    [JSON.stringify(activePayload), conf, id]
  );

  // Increment monotonic revision and update Redis keys
  const redis = getRedisClient();
  const rev = await redis.incr(`cam:${id}:rev`);
  await redis.set(`cam:${id}:classes`, JSON.stringify(resolvedActiveIds));
  await redis.set(`cam:${id}:conf`, String(conf));

  // Publish to Redis channel ai:toggle (Spec §6.2)
  const toggleMessage = {
    rev,
    camera_id: id,
    resolved_active_ids: resolvedActiveIds,
    confidence_threshold: conf,
  };
  await redis.publish("ai:toggle", JSON.stringify(toggleMessage));

  // Also emit to Socket.IO if app has socket server attached
  const io = req.app.get("io");
  if (io) {
    io.to(`camera:${id}`).emit("ai:class_state", {
      camera_id: id,
      active_classes: resolvedActiveIds,
      confidence_threshold: conf,
      rev,
    });
  }

  res.json({
    ok: true,
    camera_id: id,
    active_classes: resolvedActiveIds,
    active_yolo_classes: activePayload,
    resolved_active_ids: resolvedActiveIds,
    confidence_threshold: conf,
    rev,
  });
});

// PUT /api/cameras/:id/compression-policy
camerasRouter.put("/:id/compression-policy", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid camera ID" });
    return;
  }

  const parseResult = compressionPolicySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.issues });
    return;
  }

  const data = parseResult.data;
  const pool = getDbPool();

  const updates: string[] = [];
  const params: any[] = [];

  if (data.target_vmaf !== undefined) {
    updates.push("target_vmaf = ?");
    params.push(data.target_vmaf);
  }
  if (data.target_vmaf_p25 !== undefined) {
    updates.push("target_vmaf_p25 = ?");
    params.push(data.target_vmaf_p25);
  }
  if (data.preferred_encoder !== undefined) {
    updates.push("preferred_encoder = ?");
    params.push(data.preferred_encoder);
  }
  if (data.smart_ai_sampling !== undefined) {
    updates.push("smart_ai_sampling = ?");
    params.push(data.smart_ai_sampling ? 1 : 0);
  }

  if (updates.length > 0) {
    params.push(id);
    const updateSql = "UPDATE cameras SET " + updates.join(", ") + " WHERE id = ?";
    await pool.query(updateSql, params);
  }

  const [updatedRows] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [id]);
  if (updatedRows.length === 0) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  res.json(formatCameraResponse(updatedRows[0]));
});

