import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getDbPool } from "../db/connection.js";
import { getRedisClient } from "../redis/client.js";
import {
  deriveCredentialKey,
  encryptRtspUrl,
  decryptRtspUrl,
  maskRtspUrl,
  extractRtspHost,
} from "../crypto/credentials.js";
import {
  COCO_CLASSES,
  PRESET_GROUPS,
  DEFAULT_ACTIVE_CLASS_IDS,
  resolveActiveClassIds,
} from "../yolo/classes.js";
import { authenticateToken } from "../auth/middleware.js";

export const camerasRouter = Router();

// All camera routes require authentication
camerasRouter.use(authenticateToken);

const createCameraSchema = z.object({
  name: z.string().min(1).max(100),
  rtsp_url: z.string().regex(/^rtsp:\/\//, "URL must start with rtsp://"),
  enabled: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)).optional().default(true),
  confidence_threshold: z.number().min(0.05).max(1.0).optional().default(0.35),
  target_vmaf: z.number().min(50).max(100).optional().default(85.0),
  target_vmaf_p25: z.number().min(40).max(100).optional().default(81.0),
  preferred_encoder: z.enum(["av1_nvenc", "hevc_nvenc"]).optional().default("av1_nvenc"),
  smart_ai_sampling: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)).optional().default(true),
  preset_groups: z.union([z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
  custom_class_ids: z.array(z.number()).optional(),
});

const patchCameraSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  rtsp_url: z.string().regex(/^rtsp:\/\//, "URL must start with rtsp://").optional(),
  enabled: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)).optional(),
  confidence_threshold: z.number().min(0.05).max(1.0).optional(),
  target_vmaf: z.number().min(50).max(100).optional(),
  target_vmaf_p25: z.number().min(40).max(100).optional(),
  preferred_encoder: z.enum(["av1_nvenc", "hevc_nvenc"]).optional(),
  smart_ai_sampling: z.union([z.boolean(), z.number()]).transform((v) => Boolean(v)).optional(),
});

const toggleClassesSchema = z.object({
  preset_groups: z.union([z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
  custom_class_ids: z.array(z.number()).optional(),
  confidence_threshold: z.number().min(0.05).max(1.0).optional(),
});

const compressionPolicySchema = z.object({
  target_vmaf: z.number().min(50).max(100).optional(),
  target_vmaf_p25: z.number().min(40).max(100).optional(),
  preferred_encoder: z.enum(["av1_nvenc", "hevc_nvenc"]).optional(),
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
    static_cq_cache: row.static_cq_cache,
    static_cq_cached_at: row.static_cq_cached_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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
camerasRouter.post("/", async (req: Request, res: Response): Promise<void> => {
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

  const pool = getDbPool();
  const [result] = await pool.query<any>(
    `INSERT INTO cameras (
      name, rtsp_url_enc, rtsp_host, enabled, active_yolo_classes,
      confidence_threshold, target_vmaf, target_vmaf_p25,
      preferred_encoder, smart_ai_sampling
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      encryptedBuf,
      host,
      data.enabled ? 1 : 0,
      JSON.stringify(activePayload),
      data.confidence_threshold,
      data.target_vmaf,
      data.target_vmaf_p25,
      data.preferred_encoder,
      data.smart_ai_sampling ? 1 : 0,
    ]
  );

  const cameraId = result.insertId;

  // Initialize Redis keys for camera
  const redis = getRedisClient();
  await redis.set(`cam:${cameraId}:classes`, JSON.stringify(activePayload.resolved_active_ids));
  await redis.set(`cam:${cameraId}:conf`, String(data.confidence_threshold));
  await redis.set(`cam:${cameraId}:rev`, "1");

  const [createdRows] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [cameraId]);

  // Spec §6.2: Notify recorder and AI vision worker
  await redis.publish(
    "camera:changed",
    JSON.stringify({
      camera_id: cameraId,
      action: "added",
      rtsp_url: data.rtsp_url,
    })
  );

  res.status(201).json(formatCameraResponse(createdRows[0]));
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
camerasRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
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

  if (updates.length > 0) {
    params.push(id);
    const updateSql = "UPDATE cameras SET " + updates.join(", ") + " WHERE id = ?";
    await pool.query(updateSql, params);
  }

  const [updatedRows] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [id]);

  // Spec §6.2: Notify recorder and AI vision worker
  const redis = getRedisClient();
  await redis.publish(
    "camera:changed",
    JSON.stringify({
      camera_id: id,
      action: "updated",
      rtsp_url: data.rtsp_url,
    })
  );

  res.json(formatCameraResponse(updatedRows[0]));
});

// DELETE /api/cameras/:id
camerasRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid camera ID" });
    return;
  }

  const pool = getDbPool();
  const [result] = await pool.query<any>("DELETE FROM cameras WHERE id = ?", [id]);
  if (result.affectedRows === 0) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }

  // Clean up Redis keys
  const redis = getRedisClient();
  await redis.del(`cam:${id}:classes`, `cam:${id}:conf`, `cam:${id}:rev`);

  // Spec §6.2: Notify recorder and AI vision worker
  await redis.publish(
    "camera:changed",
    JSON.stringify({
      camera_id: id,
      action: "removed",
    })
  );

  res.json({ ok: true });
});

// PUT /api/cameras/:id/classes (Gate G3.4: Dynamic Class Toggle)
camerasRouter.put("/:id/classes", async (req: Request, res: Response): Promise<void> => {
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

  const { preset_groups, custom_class_ids = [], confidence_threshold } = parseResult.data;

  // Gate G3.4: Validate class IDs are strictly within [0, 79]
  for (const cid of custom_class_ids) {
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
  const resolvedActiveIds = resolveActiveClassIds(preset_groups, custom_class_ids);

  const activePayload = {
    preset_groups: preset_groups || {},
    custom_class_ids,
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
    resolved_active_ids: resolvedActiveIds,
    confidence_threshold: conf,
    rev,
  });
});

// PUT /api/cameras/:id/compression-policy
camerasRouter.put("/:id/compression-policy", async (req: Request, res: Response): Promise<void> => {
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

