import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getDbPool } from "../db/connection.js";
import { authenticateToken, requireRole } from "../auth/middleware.js";

export const recordingsRouter = Router();

// Stream endpoint uses authenticateToken
recordingsRouter.use(authenticateToken);

const RAW_DIR = path.resolve(process.env.RAW_DIR || "data/raw");
const COMPRESSED_DIR = path.resolve(process.env.COMPRESSED_DIR || "data/compressed");
const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");

const ALLOWED_STORAGE_DIRS = [RAW_DIR, COMPRESSED_DIR, DATA_DIR];

/**
 * Validates that target path is strictly inside allowed data directories (Spec §6.4 & §10).
 */
export function isPathSafe(targetPath: string): boolean {
  try {
    const resolved = path.resolve(targetPath);
    return ALLOWED_STORAGE_DIRS.some((dir) => {
      const resolvedDir = path.resolve(dir);
      return resolved === resolvedDir || resolved.startsWith(resolvedDir + path.sep);
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
    whereClauses.push("camera_id = ?");
    params.push(cameraId);
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

  const [countResult] = await pool.query<any[]>(
    `SELECT COUNT(*) as total FROM recordings WHERE ${whereSql}`,
    params
  );
  const total = Number(countResult[0]?.total || 0);

  const [rows] = await pool.query<any[]>(
    `SELECT * FROM recordings WHERE ${whereSql} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    total,
    page,
    limit,
    recordings: rows,
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
  const targetPath = rec.compressed_path || rec.raw_path;

  if (!targetPath) {
    res.status(404).json({ error: "No video file associated with recording" });
    return;
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

// POST /api/recordings/:id/requeue (Spec §6.4: Admin requeue)
recordingsRouter.post("/:id/requeue", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid recording ID" });
    return;
  }

  const pool = getDbPool();
  const [rows] = await pool.query<any[]>("SELECT status FROM recordings WHERE id = ?", [id]);
  if (rows.length === 0) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  const currentStatus = rows[0].status;
  if (currentStatus !== "FAILED" && currentStatus !== "QUEUED") {
    res.status(400).json({ error: `Cannot requeue recording with status ${currentStatus}` });
    return;
  }

  await pool.query("UPDATE recordings SET status = 'QUEUED', attempts = 0 WHERE id = ?", [id]);
  res.json({ ok: true, status: "QUEUED" });
});
