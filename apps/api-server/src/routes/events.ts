import { Router, type Request, type Response } from "express";
import { getDbPool } from "../db/connection.js";
import { authenticateToken } from "../auth/middleware.js";

export const eventsRouter = Router();

eventsRouter.use(authenticateToken);

// GET /api/events (camera, class, from, to; paginated)
eventsRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const pool = getDbPool();
  const cameraId = req.query.camera_id ? Number(req.query.camera_id) : undefined;
  const classId = req.query.class_id !== undefined ? Number(req.query.class_id) : undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const whereClauses: string[] = ["1=1"];
  const params: any[] = [];

  if (cameraId !== undefined && !isNaN(cameraId)) {
    whereClauses.push("camera_id = ?");
    params.push(cameraId);
  }
  if (classId !== undefined && !isNaN(classId)) {
    whereClauses.push("class_id = ?");
    params.push(classId);
  }
  if (from) {
    whereClauses.push("detected_at >= ?");
    params.push(new Date(from));
  }
  if (to) {
    whereClauses.push("detected_at <= ?");
    params.push(new Date(to));
  }

  const whereSql = whereClauses.join(" AND ");

  const [countResult] = await pool.query<any[]>(
    `SELECT COUNT(*) as total FROM ai_detection_events WHERE ${whereSql}`,
    params
  );
  const total = Number(countResult[0]?.total || 0);

  const [rows] = await pool.query<any[]>(
    `SELECT * FROM ai_detection_events WHERE ${whereSql} ORDER BY detected_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    total,
    page,
    limit,
    events: rows,
  });
});

// GET /api/vmaf/probes?recording_id=
eventsRouter.get("/probes", async (req: Request, res: Response): Promise<void> => {
  const recordingId = req.query.recording_id ? Number(req.query.recording_id) : undefined;
  if (!recordingId || isNaN(recordingId)) {
    res.status(400).json({ error: "Missing or invalid recording_id" });
    return;
  }

  const pool = getDbPool();
  const [rows] = await pool.query<any[]>(
    "SELECT * FROM vmaf_probe_logs WHERE recording_id = ? ORDER BY iteration_num ASC",
    [recordingId]
  );

  res.json({ recording_id: recordingId, probes: rows });
});
