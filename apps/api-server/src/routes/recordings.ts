import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getDbPool } from "../db/connection.js";
import { getRedisClient } from "../redis/client.js";
import { authenticateToken, authenticateMediaToken, requireRole } from "../auth/middleware.js";
import { signMediaTicket } from "../auth/service.js";
import { transitionRecordingStatus } from "../db/transitions.js";

export const recordingsRouter = Router();

// Restrict media ticket / query authentication strictly to /:id/stream and /:id/download (B-H3 / [PH4-03])
recordingsRouter.use((req, res, next) => {
  if (req.path.endsWith("/stream") || req.path.endsWith("/download")) {
    return authenticateMediaToken(req, res, next);
  }
  return authenticateToken(req, res, next);
});

const RAW_DIR_LEXICAL = path.resolve(process.env.RAW_DIR || "data/raw");
const COMPRESSED_DIR_LEXICAL = path.resolve(process.env.COMPRESSED_DIR || "data/compressed");
const DATA_DIR_LEXICAL = path.resolve(process.env.DATA_DIR || "data");

let resolvedAllowedDirsPromise: Promise<string[]> | null = null;

async function getAllowedStorageDirsAsync(): Promise<string[]> {
  if (!resolvedAllowedDirsPromise) {
    resolvedAllowedDirsPromise = Promise.all(
      [RAW_DIR_LEXICAL, COMPRESSED_DIR_LEXICAL, DATA_DIR_LEXICAL].map(async (dir) => {
        try {
          return await fsp.realpath(dir);
        } catch {
          return dir;
        }
      })
    );
  }
  const realDirs = await resolvedAllowedDirsPromise;
  return Array.from(new Set([...realDirs, RAW_DIR_LEXICAL, COMPRESSED_DIR_LEXICAL, DATA_DIR_LEXICAL]));
}

interface PathCacheEntry {
  safe: boolean;
  exists: boolean;
  expiresAt: number;
}

const PATH_CACHE_MAX_ENTRIES = 5000;
const PATH_CACHE_TTL_MS = 30_000;
const pathSafetyCache = new Map<string, PathCacheEntry>();

async function isWithinAllowedDirsAsync(candidatePath: string): Promise<boolean> {
  const allowedDirs = await getAllowedStorageDirsAsync();
  return allowedDirs.some((allowedDir) => {
    return candidatePath === allowedDir || candidatePath.startsWith(allowedDir + path.sep);
  });
}

export function clearPathSafetyCache(): void {
  pathSafetyCache.clear();
  resolvedAllowedDirsPromise = null;
}

/**
 * Asynchronous path safety + existence check with bounded LRU/TTL cache ([PB-01, PB-03, U-04]).
 */
export async function inspectPathAsync(
  targetPath: string
): Promise<{ safe: boolean; exists: boolean }> {
  try {
    const resolved = path.resolve(targetPath);
    const now = Date.now();
    const cached = pathSafetyCache.get(resolved);
    if (cached && cached.expiresAt > now) {
      pathSafetyCache.delete(resolved);
      pathSafetyCache.set(resolved, cached);
      return { safe: cached.safe, exists: cached.exists };
    }

    let realPath = resolved;
    let exists = false;
    try {
      realPath = await fsp.realpath(resolved);
      exists = true;
    } catch {
      exists = false;
    }

    const safe = await isWithinAllowedDirsAsync(realPath);
    if (pathSafetyCache.size >= PATH_CACHE_MAX_ENTRIES) {
      const oldestKey = pathSafetyCache.keys().next().value;
      if (oldestKey !== undefined) {
        pathSafetyCache.delete(oldestKey);
      }
    }
    pathSafetyCache.set(resolved, {
      safe,
      exists,
      expiresAt: now + PATH_CACHE_TTL_MS,
    });
    return { safe, exists };
  } catch {
    return { safe: false, exists: false };
  }
}

export async function isPathSafeAsync(targetPath: string): Promise<boolean> {
  const { safe } = await inspectPathAsync(targetPath);
  return safe;
}

async function isPlayableFileAsync(targetPath: string | null | undefined): Promise<boolean> {
  if (!targetPath) return false;
  const { safe, exists } = await inspectPathAsync(targetPath);
  return safe && exists;
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

  // Mask internal server filesystem paths in API response (B-M6) and expose a
  // server-verified playability flag asynchronously with bounded concurrency ([PB-01]).
  const CONCURRENCY = 16;
  const safeRecordings: any[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (r) => {
        const [rawOk, compOk] = await Promise.all([
          isPlayableFileAsync(r.raw_path),
          isPlayableFileAsync(r.compressed_path),
        ]);
        const { raw_path, compressed_path, ...rest } = r;
        return {
          ...rest,
          has_raw: rawOk,
          has_compressed: compOk,
          playable: (r.status === "RAW" || r.status === "COMPLETED") && (rawOk || compOk),
        };
      })
    );
    for (let j = 0; j < batchResults.length; j++) {
      safeRecordings[i + j] = batchResults[j];
    }
  }

  res.json({
    total,
    page,
    limit,
    recordings: safeRecordings,
  });
});

// POST /api/recordings/:id/ticket ([PB-04 / SEC-01] Short-lived scoped media ticket)
recordingsRouter.post("/:id/ticket", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid recording ID" });
    return;
  }
  const user = req.user;
  if (!user?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const expiresIn = 60;
  const ticket = signMediaTicket(user.userId, id, expiresIn, user.role, user.username);
  res.json({
    ticket,
    expiresIn,
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

// GET /api/recordings/:id/activity-windows ([PB-02] No fabricated forensic windows)
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

  // Query real indexed forensic windows from recording_activity_windows
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
      windows_source: "indexed",
    });
    return;
  }

  // [PB-02] Never synthesize fake recording_activity_windows rows with frames_processed: 20.
  const startTime = new Date(recording.started_at);
  const endTime = recording.ended_at
    ? new Date(recording.ended_at)
    : new Date(startTime.getTime() + (recording.duration_sec || 60) * 1000);

  const [events] = await pool.query<any[]>(
    "SELECT id, class_name, confidence, detected_at FROM ai_detection_events WHERE camera_id = ? AND detected_at >= ? AND detected_at <= ? ORDER BY detected_at ASC",
    [recording.camera_id, startTime, endTime]
  );

  const derivedEventBuckets = events.map((ev) => {
    const evTime = new Date(ev.detected_at).getTime();
    const offsetSec = Math.max(0, Math.floor((evTime - startTime.getTime()) / 1000));
    return {
      event_id: ev.id,
      class_name: ev.class_name,
      confidence: ev.confidence,
      start_offset_sec: offsetSec,
      frames_processed: null,
      source: "derived_from_events",
    };
  });

  res.json({
    recording_id: id,
    windows: [],
    windows_source: "unavailable",
    derived_event_buckets: derivedEventBuckets,
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
  if (rec.status === "RECORDING") {
    res.status(409).json({ error: "Recording is still in progress and cannot be played yet" });
    return;
  }
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

  // Gate G3.8 & [PB-03]: Asynchronous path traversal defense with LRU/TTL cache
  if (!(await isPathSafeAsync(targetPath))) {
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
    // Range: bytes=start-end, bytes=-suffix, or bytes=start-
    const parts = rangeHeader.replace(/bytes=/, "").trim().split("-");
    let start: number;
    let end: number;

    if (parts[0] === "" && parts[1] !== undefined) {
      // Suffix range: bytes=-500 (last 500 bytes per RFC 7233)
      const suffixLength = parseInt(parts[1], 10);
      if (isNaN(suffixLength) || suffixLength <= 0) {
        res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
        return;
      }
      start = Math.max(0, fileSize - suffixLength);
      end = fileSize - 1;
    } else {
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    }

    if (isNaN(start) || isNaN(end) || start >= fileSize || end >= fileSize || start > end) {
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
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
      stream.destroy();
    });
    res.on("close", () => {
      stream.destroy();
    });
    stream.pipe(res);
  } else {
    res.status(200);
    res.set({
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
    });

    const stream = fs.createReadStream(targetPath);
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
      stream.destroy();
    });
    res.on("close", () => {
      stream.destroy();
    });
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

  if (!(await isPathSafeAsync(targetPath))) {
    res.status(403).json({ error: "Access denied: file outside permitted storage path" });
    return;
  }

  try {
    await fsp.stat(targetPath);
  } catch {
    res.status(404).json({ error: "File not found on storage" });
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

    // Enqueue via the shared helper so a failed enqueue cannot strand the row
    // in QUEUED (it reverts to RAW for the scheduler to retry).
    const redis = getRedisClient();
    const { createTranscodeQueue } = await import("../transcode/worker.js");
    const { enqueueRecording } = await import("../transcode/enqueue.js");
    const queue = createTranscodeQueue(redis);

    const queued = await enqueueRecording(pool, queue, {
      recordingId: id,
      cameraId: recording.camera_id,
      rawPath: recording.raw_path,
    });
    if (!queued) {
      res.status(500).json({ error: "Failed to enqueue recording for transcoding" });
      return;
    }

    res.json({ ok: true, status: "QUEUED" });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to requeue recording: ${err.message}` });
  }
});

