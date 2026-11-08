import type { Pool } from "mysql2/promise";
import type { Queue } from "bullmq";
import { transitionRecordingStatus } from "../db/transitions.js";

export interface EnqueueRecordingInput {
  recordingId: number;
  cameraId: number;
  rawPath: string | null;
  priority?: number;
}

/**
 * Enqueues a transcode job with a deterministic `jobId`, then moves the
 * recording to QUEUED. If the enqueue fails, the row is reverted to RAW so it is
 * not stranded in QUEUED with no job (the scheduler only scans RAW rows).
 *
 * Returns true when the job was accepted, false when it was reverted.
 */
export async function enqueueRecording(
  pool: Pool,
  queue: Queue,
  input: EnqueueRecordingInput
): Promise<boolean> {
  const { recordingId, cameraId, rawPath, priority } = input;

  await transitionRecordingStatus(pool, recordingId, "QUEUED");

  try {
    // Drop any stale failed/stalled job so the deterministic id can be re-added.
    try {
      const existing = await queue.getJob(`rec-${recordingId}`);
      if (existing) await existing.remove();
    } catch {}

    await queue.add(
      "transcode",
      { recordingId, cameraId, rawPath },
      { jobId: `rec-${recordingId}`, priority, attempts: 3, removeOnComplete: true, removeOnFail: true }
    );
    return true;
  } catch (err: any) {
    // Revert so the scheduler can pick this recording up again later.
    try {
      await transitionRecordingStatus(pool, recordingId, "RAW");
    } catch {}
    console.error(
      `[Transcode Enqueue] Failed to enqueue #${recordingId} (reverted to RAW): ${err?.message}`
    );
    return false;
  }
}

/**
 * Re-queues rows stuck in QUEUED whose BullMQ job has vanished (e.g. the DB
 * transition committed but Redis dropped the job, or the worker crashed before
 * consuming it). Called from the scheduler tick. Returns the number recovered.
 */
export async function reconcileOrphanedQueued(
  pool: Pool,
  queue: Queue,
  staleSeconds = 300
): Promise<number> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, camera_id, raw_path
     FROM recordings
     WHERE status = 'QUEUED'
       AND updated_at < DATE_SUB(NOW(3), INTERVAL ? SECOND)
     ORDER BY updated_at ASC
     LIMIT 50`,
    [staleSeconds]
  );

  let recovered = 0;
  for (const row of rows) {
    try {
      const job = await queue.getJob(`rec-${row.id}`);
      if (job) {
        const state = await job.getState();
        if (
          state === "waiting" ||
          state === "active" ||
          state === "delayed" ||
          state === "waiting-children" ||
          state === "prioritized"
        ) {
          continue; // Job is alive; leave it alone.
        }
        await job.remove().catch(() => {});
      }

      const ok = await enqueueRecording(pool, queue, {
        recordingId: row.id,
        cameraId: row.camera_id,
        rawPath: row.raw_path,
      });
      if (ok) recovered++;
    } catch (err: any) {
      console.warn(`[Transcode Enqueue] Orphan reconcile failed for #${row.id}: ${err?.message}`);
    }
  }

  return recovered;
}
