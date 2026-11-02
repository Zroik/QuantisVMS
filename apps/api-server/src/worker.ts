import dotenv from "dotenv";
import path from "node:path";
import { getDbPool } from "./db/connection.js";
import { getRedisClient } from "./redis/client.js";
import {
  createTranscodeWorker,
  createTranscodeQueue,
  runSchedulerTick,
} from "./transcode/worker.js";
import { cleanupOrphanedConsolidatorFiles } from "./transcode/consolidator.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

export async function startWorker() {
  console.log("[Transcode Worker] Initializing BullMQ GPU worker (Spec §8.7)...");
  const pool = getDbPool();
  const redis = getRedisClient();
  const queue = createTranscodeQueue(redis);
  const worker = createTranscodeWorker(pool, redis, undefined, {
    concurrency: Number(process.env.TRANSCODE_CONCURRENCY) || 1,
  });

  const schedulerIntervalMs = Number(process.env.SCHEDULER_INTERVAL_MS) || 15000;
  const dataDir = process.env.DATA_DIR || "data";

  console.log(`[Transcode Worker] Worker active. Scheduler tick every ${schedulerIntervalMs / 1000}s`);

  let isShuttingDown = false;
  let tickInProgress = false;
  let timerId: NodeJS.Timeout | null = null;

  // Cleanup orphaned temporary files on startup
  try {
    await cleanupOrphanedConsolidatorFiles(dataDir);
  } catch {}

  const runTickSafely = async () => {
    if (isShuttingDown || tickInProgress) return;
    tickInProgress = true;
    try {
      const tick = await runSchedulerTick(pool, queue, redis, dataDir);
      if (tick.enqueued > 0) {
        console.log(`[Transcode Scheduler] Enqueued ${tick.enqueued} recordings.`);
      }
    } catch (err: any) {
      console.error("[Transcode Scheduler] Tick error:", err.message);
    } finally {
      tickInProgress = false;
    }
  };

  // Initial tick
  await runTickSafely();

  // Recursive timeout loop ensures next tick ONLY runs after previous tick completely finishes
  const scheduleNext = () => {
    if (isShuttingDown) return;
    timerId = setTimeout(async () => {
      await runTickSafely();
      scheduleNext();
    }, schedulerIntervalMs);
  };
  scheduleNext();

  const shutdown = async () => {
    console.log("[Transcode Worker] Shutting down worker...");
    isShuttingDown = true;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    await worker.close();
    await queue.close();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("worker.ts") || process.argv[1].endsWith("worker.js"))
) {
  startWorker().catch(console.error);
}

