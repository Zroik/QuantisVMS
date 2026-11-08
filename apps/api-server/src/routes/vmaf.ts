import { Router, type Request, type Response } from "express";
import { getDbPool } from "../db/connection.js";
import { authenticateToken } from "../auth/middleware.js";

/**
 * Spec §6.4 canonical VMAF probe endpoint. The data previously lived only under
 * `/api/events/probes` and `/api/stats/vmaf-probes`; this is the documented path.
 */
export const vmafRouter = Router();

vmafRouter.use(authenticateToken);

vmafRouter.get("/probes", async (req: Request, res: Response): Promise<void> => {
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
