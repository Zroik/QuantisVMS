import type { Pool } from "mysql2/promise";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import fs from "node:fs/promises";
import { transitionRecordingStatus } from "../db/transitions.js";

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePct: number;
}

export interface WatermarkResult {
  level: "normal" | "high" | "critical";
  usagePct: number;
  enqueuedCount: number;
  alertEmitted: boolean;
}

/**
 * Checks disk space usage of the specified data directory.
 */
export async function getDiskUsage(dataDir: string): Promise<DiskUsage> {
  try {
    const stat = await fs.statfs(dataDir);
    const totalBytes = stat.bsize * stat.blocks;
    const freeBytes = stat.bsize * stat.bavail;
    const usedBytes = totalBytes - freeBytes;
    const usagePct = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usagePct: Number(usagePct.toFixed(2)),
    };
  } catch {
    // Fallback if statfs is unavailable on certain Windows environments
    return {
      totalBytes: 1000 * 1024 ** 3,
      freeBytes: 500 * 1024 ** 3,
      usedBytes: 500 * 1024 ** 3,
      usagePct: 50.0,
    };
  }
}

/**
 * Evaluates disk watermark and enforces early enqueuing (Spec §8.7, Gate G4.9).
 * If usage >= DISK_HIGH_WATERMARK_PCT: enqueues RAW recordings regardless of age (oldest first).
 * At DISK_CRITICAL_PCT: emits critical alert.
 * The system MUST NOT delete unverified data to free space.
 */
export async function evaluateDiskWatermark(
  usagePct: number,
  pool: Pool,
  queue?: Queue | null,
  redis?: Redis | null,
  options: {
    highWatermarkPct?: number;
    criticalWatermarkPct?: number;
    delaySeconds?: number;
  } = {}
): Promise<WatermarkResult> {
  const highWatermark = options.highWatermarkPct ?? Number(process.env.DISK_HIGH_WATERMARK_PCT) ?? 85;
  const criticalWatermark = options.criticalWatermarkPct ?? Number(process.env.DISK_CRITICAL_PCT) ?? 95;
  const delaySeconds = options.delaySeconds ?? 86400;

  let level: "normal" | "high" | "critical" = "normal";
  if (usagePct >= criticalWatermark) {
    level = "critical";
  } else if (usagePct >= highWatermark) {
    level = "high";
  }

  if (level === "normal") {
    return { level, usagePct, enqueuedCount: 0, alertEmitted: false };
  }

  // Find finished RAW recordings, oldest first (Spec §8.7, Gate G4.9).
  // At high/critical watermark, early transcode enqueue is triggered regardless of retention age.
  // Delay threshold is applied only if explicitly configured in options.
  const shouldApplyDelay = options.delaySeconds !== undefined && options.delaySeconds > 0;
  const query = shouldApplyDelay
    ? "SELECT id, camera_id, raw_path FROM recordings WHERE status = 'RAW' AND TIMESTAMPDIFF(SECOND, started_at, NOW(3)) >= ? ORDER BY started_at ASC"
    : "SELECT id, camera_id, raw_path FROM recordings WHERE status = 'RAW' ORDER BY started_at ASC";

  const params = shouldApplyDelay ? [options.delaySeconds] : [];
  const [rows] = await pool.query<any[]>(query, params);

  let enqueuedCount = 0;
  for (const row of rows) {
    try {
      await transitionRecordingStatus(pool, row.id, "QUEUED");
      if (queue) {
        await queue.add(
          "transcode",
          { recordingId: row.id, cameraId: row.camera_id, rawPath: row.raw_path },
          { jobId: `rec-${row.id}`, attempts: 3 }
        );
      }
      enqueuedCount++;
    } catch {
      // Ignore transition error if state changed concurrently
    }
  }

  // Emit system:alert via Redis (Spec §8.7)
  let alertEmitted = false;
  if (redis) {
    await redis.publish(
      "system:alert",
      JSON.stringify({
        level: level === "critical" ? "critical" : "warning",
        type: "disk_watermark",
        usage_pct: usagePct,
        high_watermark: highWatermark,
        critical_watermark: criticalWatermark,
        enqueued_count: enqueuedCount,
        timestamp: new Date().toISOString(),
      })
    );
    alertEmitted = true;
  }

  return { level, usagePct, enqueuedCount, alertEmitted };
}

