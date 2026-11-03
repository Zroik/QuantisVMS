import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getDbPool } from "../db/connection.js";
import { getRedisClient } from "../redis/client.js";
import { authenticateToken, authenticateMediaToken, requireRole } from "../auth/middleware.js";
import { transitionRecordingStatus } from "../db/transitions.js";

export const recordingsRouter = Router();

// Restrict query-string tokens to /:id/stream only (B-H3)
recordingsRouter.use((req, res, next) => {
  if (req.path.endsWith("/stream")) {
    return authenticateMediaToken(req, res, next);
  }
  return authenticateToken(req, res, next);
});

const RAW_DIR = path.resolve(process.env.RAW_DIR || "data/raw");
const COMPRESSED_DIR = path.resolve(process.env.COMPRESSED_DIR || "data/compressed");
const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");

const ALLOWED_STORAGE_DIRS = [RAW_DIR, COMPRESSED_DIR, DATA_DIR];

/**
 * Validates that target path is strictly inside allowed data directories (Spec §6.4 & §10, B-M5).
 * Resolves realpath to prevent symlink traversal.
 */
export function isPathSafe(targetPath: string): boolean {
  try {
    const resolved = path.resolve(targetPath);
    let realPath = resolved;
    if (fs.existsSync(resolved)) {
      try { realPath = fs.realpathSync(resolved); } catch {}
    }
    return ALLOWED_STORAGE_DIRS.some((dir) => {
      const resolvedDir = path.resolve(dir);
      let realDir = resolvedDir;
      if (fs.existsSync(resolvedDir)) {
        try { realDir = fs.realpathSync(resolvedDir); } catch {}
      }
      return realPath === realDir || realPath.startsWith(realDir + path.sep);
    });
  } catch {
    return false;
  }
}

// GET /api/recordings (Spec §6.4: filters camera, from, to, status; paginated)
recordingsRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const pool = getDbPool();
  const cameraId = req.query.camera_id ? Number(req.query.camera_id) : undefined;
  const status = req.query.status as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = ["1=1"];
  const params: any[] = [];

  if (cameraId) {
    // Check if camera is a child slice of a multi-sensor parent
    const [camRows] = await pool.query<any[]>("SELECT parent_camera_id FROM cameras WHERE id = ?", [cameraId]);
    const parentId = camRows[0]?.parent_camera_id;
    if (parentId) {
      whereClauses.push("(camera_id = ? OR camera_id = ?)");
      params.push(cameraId, parentId);
    } else {
      whereClauses.push("camera_id = ?");
      params.push(cameraId);
    }
  }
  if (status) {
    whereClauses.push("status = ?");
    params.push(status);
  }
  if (from) {
    whereClauses.push("started_at >= ?");
    params.push(new Date(from));
  }
  if (to) {
    whereClauses.push("started_at <= ?");
    params.push(new Date(to));
  }

  const whereSql = whereClauses.join(" AND ");
  const countSql = "SELECT COUNT(*) as total FROM recordings WHERE " + whereSql;
  const selectSql = "SELECT * FROM recordings WHERE " + whereSql + " ORDER BY started_at DESC LIMIT ? OFFSET ?";

  const [countResult] = await pool.query<any[]>(countSql, params);
  const total = Number(countResult[0]?.total || 0);

  const [rows] = await pool.query<any[]>(selectSql, [...params, limit, offset]);

  // Mask internal server filesystem paths in API response (B-M6)
  const safeRecordings = rows.map((r) => {
    const { raw_path, ...rest } = r;
    return {
      ...rest,
      has_raw: Boolean(raw_path),
    };
  });

  res.json({
    total,
    page,
    limit,
    recordings: safeRecordings,
  });
});

// GET /api/recordings/:id (Spec §6.4: chunks, probes)
recordingsRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid recording ID" });
    return;
  }

  const pool = getDbPool();
  const [rows] = await pool.query<any[]>("SELECT * FROM recordings WHERE id = ?", [id]);
  if (rows.length === 0) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  const recording = rows[0];

  const [chunks] = await pool.query<any[]>(
    "SELECT * FROM recording_chunks WHERE recording_id = ? ORDER BY chunk_index ASC",
    [id]
  );

  const [probes] = await pool.query<any[]>(
    "SELECT * FROM vmaf_probe_logs WHERE recording_id = ? ORDER BY iteration_num ASC",
    [id]
  );

  res.json({
    ...recording,
    chunks,
    probes,
  });
});

// GET /api/recordings/:id/activity-windows
recordingsRouter.get("/:id/activity-windows", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid recording ID" });
    return;
  }

  const pool = getDbPool();
  const [recRows] = await pool.query<any[]>(
    "SELECT id, camera_id, started_at, ended_at, duration_sec FROM recordings WHERE id = ?",
    [id]
  );
  if (recRows.length === 0) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  const recording = recRows[0];

  // First check recording_activity_windows
  const [rows] = await pool.query<any[]>(
    "SELECT window_index, start_offset_sec, person_count, vehicle_count, pet_count, other_count, frames_processed, weighted_activity_score FROM recording_activity_windows WHERE recording_id = ? ORDER BY window_index ASC",
    [id]
  );

  if (rows.length > 0) {
    const recStartEpoch = Math.floor(new Date(recording.started_at).getTime() / 1000);
    const maxDuration = recording.duration_sec || 60;
    const normalizedRows = rows.map((r, idx) => {
      let offset = Number(r.start_offset_sec);
      if (offset >= 1000000000) {
        offset = Math.max(0, offset - recStartEpoch);
      }
      if (offset >= maxDuration) {
        offset = Math.min(maxDuration - 1, idx * 5);
      }
      return {
        ...r,
        start_offset_sec: Math.max(0, offset),
      };
    });

    res.json({
      recording_id: id,
      windows: normalizedRows,
    });
    return;
  }

  // Synthesize from real ai_detection_events if window table has no rows yet
  const startTime = new Date(recording.started_at);
  const endTime = recording.ended_at ? new Date(recording.ended_at) : new Date(startTime.getTime() + (recording.duration_sec || 60) * 1000);

  const [events] = await pool.query<any[]>(
    "SELECT id, class_name, confidence, detected_at FROM ai_detection_events WHERE camera_id = ? AND detected_at >= ? AND detected_at <= ? ORDER BY detected_at ASC",
    [recording.camera_id, startTime, endTime]
  );

  const durationSec = Math.max(10, recording.duration_sec || 60);
  const windowSize = 5; // 5s buckets
  const totalWindows = Math.ceil(durationSec / windowSize);
  const synthesizedWindows: any[] = [];

  for (let w = 0; w < totalWindows; w++) {
    const wStartSec = w * windowSize;
    const wEndSec = (w + 1) * windowSize;
    const wStartTime = startTime.getTime() + wStartSec * 1000;
    const wEndTime = startTime.getTime() + wEndSec * 1000;

    const wEvents = events.filter((e) => {
      const eTime = new Date(e.detected_at).getTime();
      return eTime >= wStartTime && eTime < wEndTime;
    });

    let personCount = 0;
    let vehicleCount = 0;
    let petCount = 0;
    let otherCount = 0;
    let score = 0;

    for (const ev of wEvents) {
      const c = (ev.class_name || "").toLowerCase();
      if (c === "person") {
        personCount++;
        score += 3.0;
      } else if (["car", "truck", "bus", "motorcycle", "bicycle"].includes(c)) {
        vehicleCount++;
        score += 2.0;
      } else if (["cat", "dog", "bird"].includes(c)) {
        petCount++;
        score += 1.0;
      } else {
        otherCount++;
        score += 1.0;
      }
    }

    synthesizedWindows.push({
      window_index: w,
      start_offset_sec: wStartSec,
      person_count: personCount,
      vehicle_count: vehicleCount,
      pet_count: petCount,
      other_count: otherCount,
      frames_processed: 20,
      weighted_activity_score: Number(score.toFixed(1)),
    });
  }

  res.json({
    recording_id: id,
    windows: synthesizedWindows,
  });
});

// GET /api/recordings/:id/stream (Gate G3.8: HTTP Range 206, unauth 401, traversal blocked)
recordingsRouter.get("/:id/stream", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid recording ID" });
    return;
  }

  const pool = getDbPool();
  const [rows] = await pool.query<any[]>(
    "SELECT id, raw_path, compressed_path, status FROM recordings WHERE id = ?",
    [id]
  );

  if (rows.length === 0) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  const rec = rows[0];
  const mode = req.query.mode as string | undefined;

  let targetPath = rec.compressed_path || rec.raw_path;
  if (mode === "raw" && rec.raw_path) {
    targetPath = rec.raw_path;
  } else if (mode === "compressed" && rec.compressed_path) {
    targetPath = rec.compressed_path;
  }

  if (!targetPath) {
    res.status(404).json({ error: "No video file associated with recording" });
    return;
  }

  // Gracefully fallback to raw_path if compressed file is not on disk yet
  try {
    await fsp.access(targetPath);
  } catch {
    if (rec.raw_path && targetPath !== rec.raw_path) {
      targetPath = rec.raw_path;
    }
  }

  // Gate G3.8: Path traversal defense
  if (!isPathSafe(targetPath)) {
    res.status(403).json({ error: "Access denied: file outside permitted storage path" });
    return;
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(targetPath);
  } catch {
    res.status(404).json({ error: "File not found on storage" });
    return;
  }

  const fileSize = stat.size;
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    // Range: bytes=start-end
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
      return;
    }

    const chunkSize = end - start + 1;
    res.status(206);
    res.set({
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": "video/mp4",
    });

    const stream = fs.createReadStream(targetPath, { start, end });
    stream.pipe(res);
  } else {
    res.status(200);
    res.set({
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
    });

    const stream = fs.createReadStream(targetPath);
    stream.pipe(res);
  }
});

// GET /api/recordings/:id/download (Export / Download segment MP4)
recordingsRouter.get("/:id/download", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid recording ID" });
    return;
  }

  const pool = getDbPool();
  const [rows] = await pool.query<any[]>(
    "SELECT id, camera_id, raw_path, compressed_path, started_at FROM recordings WHERE id = ?",
    [id]
  );

  if (rows.length === 0) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  const rec = rows[0];
  const mode = req.query.mode as string | undefined;

  let targetPath = rec.compressed_path || rec.raw_path;
  if (mode === "raw" && rec.raw_path) {
    targetPath = rec.raw_path;
  } else if (mode === "compressed" && rec.compressed_path) {
    targetPath = rec.compressed_path;
  }

  if (!targetPath) {
    res.status(404).json({ error: "No video file associated with recording" });
    return;
  }

  try {
    await fsp.access(targetPath);
  } catch {
    if (rec.raw_path && targetPath !== rec.raw_path) {
      targetPath = rec.raw_path;
    }
  }

  if (!isPathSafe(targetPath)) {
    res.status(403).json({ error: "Access denied: file outside permitted storage path" });
    return;
  }

  const d = new Date(rec.started_at);
  const dateStr = d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const filename = `Cam${rec.camera_id}_${dateStr}_#${id}.mp4`;

  res.download(targetPath, filename);
});

// POST /api/recordings/:id/requeue (Spec §6.4: Admin requeue, B-H1)
recordingsRouter.post("/:id/requeue", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid recording ID" });
    return;
  }

  const pool = getDbPool();
  const [rows] = await pool.query<any[]>(
    "SELECT id, camera_id, raw_path, status, started_at, raw_size_bytes FROM recordings WHERE id = ?",
    [id]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  const recording = rows[0];
  const currentStatus = recording.status;
  if (currentStatus !== "FAILED" && currentStatus !== "QUEUED" && currentStatus !== "SKIPPED") {
    res.status(400).json({ error: `Cannot requeue recording with status ${currentStatus}` });
    return;
  }

  try {
    await transitionRecordingStatus(pool, id, "QUEUED", { attempts: 0 });

    // Enqueue BullMQ job with deterministic deduplicated jobId
    const redis = getRedisClient();
    const { createTranscodeQueue } = await import("../transcode/worker.js");
    const queue = createTranscodeQueue(redis);

    try {
      const existing = await queue.getJob(`rec-${id}`);
      if (existing) await existing.remove();
    } catch {}

    await queue.add(
      "transcode",
      { recordingId: id, cameraId: recording.camera_id, rawPath: recording.raw_path },
      { jobId: `rec-${id}`, attempts: 3, removeOnComplete: true, removeOnFail: true }
    );

    res.json({ ok: true, status: "QUEUED" });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to requeue recording: ${err.message}` });
  }
});

