import { Queue, Worker, type Job } from "bullmq";
import type { Pool } from "mysql2/promise";
import type { Redis } from "ioredis";
import { getRedisClient } from "../redis/client.js";
import { processRecordingTranscode } from "./pipeline.js";
import { recomputeHourlyPriorities, computeTranscodePriority } from "./priority.js";
import { evaluateDiskWatermark, getDiskUsage } from "./watermark.js";
import { transitionRecordingStatus } from "../db/transitions.js";

export const TRANSCODE_QUEUE_NAME = "transcode";

export function createTranscodeQueue(redisClient?: Redis): Queue {
  const connection = redisClient || getRedisClient();
  return new Queue(TRANSCODE_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });
}

export function createTranscodeWorker(
  pool: Pool,
  redisClient?: Redis,
  io?: any,
  options: { concurrency?: number } = {}
): Worker {
  const connection = redisClient || getRedisClient();
  const concurrency = options.concurrency ?? Number(process.env.TRANSCODE_CONCURRENCY) ?? 1;

  const worker = new Worker(
    TRANSCODE_QUEUE_NAME,
    async (job: Job) => {
      const recordingId = job.data?.recordingId;
      if (!recordingId) {
        throw new Error("Job missing recordingId");
      }

      const result = await processRecordingTranscode(recordingId, {
        pool,
        redis: connection,
        io,
      });

      return result;
    },
    {
      connection,
      concurrency,
      lockDuration: 300000, // 5 min lock extension
    }
  );

  worker.on("failed", async (job, err) => {
    if (job?.data?.recordingId) {
      try {
        await pool.query(
          "UPDATE recordings SET status = 'FAILED', failure_reason = ? WHERE id = ?",
          [err.message, job.data.recordingId]
        );
      } catch {}
    }
  });

  return worker;
}

/**
 * Hourly Cron Scheduler (Spec §8.7).
 * 1. Checks disk watermarks.
 * 2. Re-prioritizes waiting jobs.
 * 3. Enqueues eligible RAW recordings.
 */
export async function runSchedulerTick(
  pool: Pool,
  queue: Queue,
  redis: Redis,
  dataDir: string
): Promise<{ enqueued: number; reprioritized: number }> {
  // 1. Watermark check (Gate G4.9)
  const usage = await getDiskUsage(dataDir);
  await evaluateDiskWatermark(usage.usagePct, pool, queue, redis);

  // 2. Recompute priorities for waiting jobs (Gate G4.2)
  const { recomputed } = await recomputeHourlyPriorities(queue, pool);

  // 3. Enqueue eligible RAW recordings (Spec §8.7)
  const rawRetentionSec = Number(process.env.RAW_RETENTION_SEC) || 86400;
  const [rows] = await pool.query<any[]>(
    `SELECT r.id, r.camera_id, r.raw_path, r.started_at, r.ended_at, r.raw_size_bytes,
            COALESCE(SUM(w.weighted_activity_score), 0) as total_activity
     FROM recordings r
     LEFT JOIN recording_activity_windows w ON w.recording_id = r.id
     WHERE r.status = 'RAW'
       AND (r.ended_at IS NOT NULL AND TIMESTAMPDIFF(SECOND, r.ended_at, NOW(3)) >= ?)
     GROUP BY r.id`,
    [rawRetentionSec]
  );

  let enqueued = 0;
  for (const row of rows) {
    try {
      await transitionRecordingStatus(pool, row.id, "QUEUED");

      const ageHours = (Date.now() - new Date(row.started_at).getTime()) / (1000 * 3600);
      const { priority } = computeTranscodePriority({
        ageHours,
        rawSizeBytes: Number(row.raw_size_bytes || 0),
        totalActivityScore: Number(row.total_activity || 0),
      });

      await queue.add(
        "transcode",
        { recordingId: row.id, cameraId: row.camera_id, rawPath: row.raw_path },
        { jobId: `rec-${row.id}`, priority, attempts: 3 }
      );
      enqueued++;
    } catch {
      // Ignore if status changed concurrently
    }
  }

  return { enqueued, reprioritized: recomputed };
}

