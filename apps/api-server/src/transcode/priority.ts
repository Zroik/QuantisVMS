import type { Queue } from "bullmq";
import type { Pool } from "mysql2/promise";

export interface PriorityParams {
  ageHours: number;
  rawSizeBytes: number;
  totalActivityScore: number;
  wAge?: number;
  wSize?: number;
  wCheap?: number;
  activityRef?: number;
}

/**
 * Priority calculation per Spec §8.7.
 * BullMQ convention: lower number = served first (1 is top priority, 100 is bottom).
 */
export function computeTranscodePriority(params: PriorityParams): { score: number; priority: number } {
  const {
    ageHours,
    rawSizeBytes,
    totalActivityScore,
    wAge = Number(process.env.QUEUE_W_AGE) || 0.5,
    wSize = Number(process.env.QUEUE_W_SIZE) || 0.2,
    wCheap = Number(process.env.QUEUE_W_CHEAP) || 0.3,
    activityRef = 500.0,
  } = params;

  const rawGb = rawSizeBytes / (1024 ** 3);

  const age = Math.min(1.0, Math.max(0, ageHours / 48));
  // Smaller files have higher "size score" (shortest job first)
  const size = 1.0 - Math.min(1.0, Math.max(0, rawGb / 4));
  // Quieter files have higher "cheap score"
  const cheap = 1.0 - Math.min(1.0, Math.max(0, totalActivityScore / activityRef));

  const score = wAge * age + wSize * size + wCheap * cheap;
  const clampedScore = Math.min(1.0, Math.max(0.0, score));

  // BullMQ priority: 1 (highest) to 100 (lowest)
  const priority = 1 + Math.round((1.0 - clampedScore) * 99);

  return {
    score: Number(clampedScore.toFixed(4)),
    priority: Math.min(100, Math.max(1, priority)),
  };
}

/**
 * Recomputes priorities for all waiting jobs in BullMQ queue (Spec §8.7, Gate G4.2).
 */
export async function recomputeHourlyPriorities(
  queue: Queue,
  pool: Pool
): Promise<{ recomputed: number }> {
  const waitingJobs = await queue.getWaiting();
  if (waitingJobs.length === 0) return { recomputed: 0 };

  const recordingIds = [
    ...new Set(
      waitingJobs
        .map((job) => Number(job.data?.recordingId))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];
  if (recordingIds.length === 0) return { recomputed: 0 };

  // One aggregate query for every waiting recording instead of one query per job.
  const [rows] = await pool.query<any[]>(
    `SELECT r.id, r.started_at, r.raw_size_bytes,
            COALESCE(SUM(w.weighted_activity_score), 0) as total_activity
     FROM recordings r
     LEFT JOIN recording_activity_windows w ON w.recording_id = r.id
     WHERE r.id IN (?)
     GROUP BY r.id, r.started_at, r.raw_size_bytes`,
    [recordingIds]
  );
  const byId = new Map<number, any>(rows.map((row) => [Number(row.id), row]));

  let recomputed = 0;
  for (const job of waitingJobs) {
    const recordingId = Number(job.data?.recordingId);
    const row = byId.get(recordingId);
    if (!row) continue;

    const ageHours = (Date.now() - new Date(row.started_at).getTime()) / (1000 * 3600);
    const { priority } = computeTranscodePriority({
      ageHours,
      rawSizeBytes: Number(row.raw_size_bytes || 0),
      totalActivityScore: Number(row.total_activity || 0),
    });

    if (job.opts?.priority !== priority) {
      await job.changePriority({ priority });
      recomputed++;
    }
  }

  return { recomputed };
}

