import fs from "node:fs";
import fsp from "node:fs/promises";
import { Queue, Worker, type Job } from "bullmq";
import type { Pool } from "mysql2/promise";
import type { Redis } from "ioredis";
import { getRedisClient } from "../redis/client.js";
import { processRecordingTranscode } from "./pipeline.js";
import { recomputeHourlyPriorities, computeTranscodePriority } from "./priority.js";
import { evaluateDiskWatermark, getDiskUsage } from "./watermark.js";
import { transitionRecordingStatus } from "../db/transitions.js";
import { enqueueRecording, reconcileOrphanedQueued } from "./enqueue.js";
import { consolidateHourlyRecordings } from "./consolidator.js";

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
  const envConcurrency = Number(process.env.TRANSCODE_CONCURRENCY);
  // Number(undefined) is NaN, and ?? does not treat NaN as nullish.
  const concurrency =
    options.concurrency ?? (Number.isFinite(envConcurrency) && envConcurrency > 0 ? envConcurrency : 1);

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

  worker.on("error", (err) => {
    console.error("[Transcode Worker] Worker error:", err);
  });

  worker.on("failed", async (job, err) => {
    if (job?.data?.recordingId) {
      try {
        await pool.query(
          "UPDATE recordings SET attempts = attempts + 1 WHERE id = ?",
          [job.data.recordingId]
        );
      } catch {}
      try {
        await transitionRecordingStatus(pool, job.data.recordingId, "FAILED", {
          failure_reason: err.message,
        });
      } catch (transitionErr: any) {
        // Terminal states (COMPLETED/SKIPPED) must never be downgraded.
        console.error(
          `[Transcode Worker] Could not mark #${job.data.recordingId} FAILED: ${transitionErr.message}`
        );
      }
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
): Promise<{ enqueued: number; reprioritized: number; recovered: number }> {
  // Liveness heartbeat belongs at the start of the tick: if a later step
  // (consolidation/ffprobe) hangs, the healthcheck must still see the loop.
  await redis
    .set("transcode:heartbeat", String(Date.now()), "EX", 90)
    .catch((err) => console.warn("[Transcode Scheduler] Heartbeat failed:", err.message));

  // Fetch configured compression delay and recording options from system_config
  let compressionDelayHours = 24;
  let autoConsolidateHourly = true;
  try {
    const [cfgRows] = await pool.query<any[]>(
      "SELECT config_key, config_value FROM system_config WHERE config_key IN ('compression', 'storage', 'recording')"
    );
    for (const row of cfgRows) {
      if (row.config_value) {
        const parsed = typeof row.config_value === "string" ? JSON.parse(row.config_value) : row.config_value;
        if (row.config_key === "compression" && parsed?.compressionDelayHours != null) {
          compressionDelayHours = Number(parsed.compressionDelayHours);
        } else if (row.config_key === "storage" && compressionDelayHours === 24 && parsed?.retentionGraceHours != null) {
          compressionDelayHours = Number(parsed.retentionGraceHours);
        } else if (row.config_key === "recording" && parsed?.autoConsolidateHourly !== undefined) {
          autoConsolidateHourly = Boolean(parsed.autoConsolidateHourly);
        }
      }
    }
  } catch {
    // fallback
  }

  if (isNaN(compressionDelayHours) || compressionDelayHours <= 0) {
    compressionDelayHours = 24;
  }
  const delaySeconds = Math.round(compressionDelayHours * 3600);

  // 1. Watermark check (Gate G4.9)
  const usage = await getDiskUsage(dataDir);
  await evaluateDiskWatermark(usage.usagePct, pool, queue, redis);

  // 2. Recompute priorities for waiting jobs (Gate G4.2)
  const { recomputed } = await recomputeHourlyPriorities(queue, pool);

  // 2.5 Consolidate fragmented past clock-hour segments into 1 clean video (if enabled)
  if (autoConsolidateHourly) {
    await consolidateHourlyRecordings(pool, dataDir, redis);
  }

  // 2.7 Deferred raw deletion pass. Only delete when the quality gate was
  // met, the compressed artifact exists, and the operator opted in.
  try {
    const deleteAfterVerify = process.env.DELETE_RAW_AFTER_VERIFY === "true";
    if (deleteAfterVerify) {
      let rawDeleteGraceSec = 3600;
      const envGrace = Number(process.env.RAW_DELETE_GRACE_SEC);
      if (Number.isFinite(envGrace) && envGrace >= 0) rawDeleteGraceSec = envGrace;
      try {
        const [storageCfg] = await pool.query<any[]>(
          "SELECT config_value FROM system_config WHERE config_key = 'storage'"
        );
        if (storageCfg.length > 0 && storageCfg[0].config_value) {
          const parsed = typeof storageCfg[0].config_value === "string" ? JSON.parse(storageCfg[0].config_value) : storageCfg[0].config_value;
          const configured = Number(parsed?.rawDeleteGraceSec);
          if (Number.isFinite(configured) && configured >= 0) rawDeleteGraceSec = configured;
        }
      } catch {}

      const [eligibleForRawDelete] = await pool.query<any[]>(
        `SELECT id, raw_path, compressed_path, verified_at
         FROM recordings
         WHERE status = 'COMPLETED'
           AND quality_gate_met = 1
           AND compressed_path IS NOT NULL
           AND raw_deleted_at IS NULL
           AND raw_path IS NOT NULL
           AND verified_at IS NOT NULL
           AND verified_at <= DATE_SUB(NOW(3), INTERVAL ? SECOND)
         LIMIT 50`,
        [rawDeleteGraceSec]
      );

      for (const rec of eligibleForRawDelete) {
        try {
          if (!rec.compressed_path || !fs.existsSync(rec.compressed_path)) {
            console.warn(`[Worker] Keeping raw for #${rec.id}: compressed artifact is missing`);
            continue;
          }
          if (rec.raw_path && fs.existsSync(rec.raw_path)) {
            await fsp.unlink(rec.raw_path);
          }
          await pool.query(
            "UPDATE recordings SET raw_deleted_at = NOW(3) WHERE id = ?",
            [rec.id]
          );
        } catch (err: any) {
          console.warn(`[Worker] Failed deferred raw deletion for recording #${rec.id}:`, err.message);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Worker] Error during deferred raw deletion pass:`, err.message);
  }

  // 3. Enqueue eligible RAW recordings whose age has reached the delay threshold (Spec §8.7)
  // Age is calculated from started_at per user specification:
  // e.g. recording 18:00 - 19:00 begins probing & transcode the following day at 18:00 (24h after started_at).
  const [rows] = await pool.query<any[]>(
    `SELECT r.id, r.camera_id, r.raw_path, r.started_at, r.ended_at, r.raw_size_bytes,
            COALESCE(SUM(w.weighted_activity_score), 0) as total_activity
     FROM recordings r
     LEFT JOIN recording_activity_windows w ON w.recording_id = r.id
     WHERE r.status = 'RAW'
       AND r.ended_at IS NOT NULL
       AND TIMESTAMPDIFF(SECOND, r.started_at, NOW(3)) >= ?
     GROUP BY r.id
     ORDER BY r.started_at ASC
     LIMIT 50`,
    [delaySeconds]
  );

  let enqueued = 0;
  for (const row of rows) {
    const ageHours = (Date.now() - new Date(row.started_at).getTime()) / (1000 * 3600);
    const { priority } = computeTranscodePriority({
      ageHours,
      rawSizeBytes: Number(row.raw_size_bytes || 0),
      totalActivityScore: Number(row.total_activity || 0),
    });

    try {
      const queued = await enqueueRecording(pool, queue, {
        recordingId: row.id,
        cameraId: row.camera_id,
        rawPath: row.raw_path,
        priority,
      });
      if (queued) enqueued++;
    } catch (err: any) {
      console.warn(`[Transcode Scheduler] Skipped #${row.id}: ${err.message}`);
    }
  }

  // 4. Recover QUEUED rows whose BullMQ job vanished (failed enqueue / Redis loss).
  const recovered = await reconcileOrphanedQueued(pool, queue).catch((err: any) => {
    console.warn("[Transcode Scheduler] Orphan reconcile failed:", err.message);
    return 0;
  });

  return { enqueued, reprioritized: recomputed, recovered };
}

