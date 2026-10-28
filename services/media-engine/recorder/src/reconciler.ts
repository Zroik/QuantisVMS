import type { Pool } from "mysql2/promise";
import type { Redis } from "ioredis";
import fs from "node:fs/promises";
import { probeVideo } from "./probe.js";

/**
 * Startup Reconciler (Spec §8.1, Gate G3.7).
 * Reconciles abandoned recordings with status RECORDING.
 * Fragmented MP4 files retain readable content up to the crash moment.
 */
export async function reconcileOrphanRecordings(
  pool: Pool,
  redis?: Redis | null
): Promise<{ recovered: number; failed: number }> {
  let recovered = 0;
  let failed = 0;

  const [rows] = await pool.query<any[]>(
    "SELECT id, camera_id, raw_path, started_at FROM recordings WHERE status = 'RECORDING'"
  );

  for (const row of rows) {
    const { id, raw_path, started_at } = row;

    try {
      // Check file existence
      await fs.access(raw_path);

      // Probe with ffprobe
      const probe = await probeVideo(raw_path);

      if (probe.durationSec > 0) {
        const startedTime = new Date(started_at).getTime();
        const endedAt = new Date(startedTime + Math.round(probe.durationSec * 1000));

        await pool.query(
          `UPDATE recordings SET
            status = 'RAW',
            ended_at = ?,
            duration_sec = ?,
            width = ?,
            height = ?,
            fps = ?,
            codec_raw = ?,
            raw_size_bytes = ?
          WHERE id = ?`,
          [
            endedAt,
            Math.round(probe.durationSec),
            probe.width,
            probe.height,
            probe.fps,
            probe.codec,
            probe.sizeBytes,
            id,
          ]
        );
        recovered++;
      } else {
        throw new Error("Zero duration recorded before crash");
      }
    } catch (err: any) {
      failed++;
      await pool.query(
        "UPDATE recordings SET status = 'FAILED', failure_reason = ? WHERE id = ?",
        [`Crash recovery probe failure: ${err.message}`, id]
      );

      if (redis) {
        await redis.publish(
          "system:alert",
          JSON.stringify({
            level: "error",
            type: "recording_recovery_failed",
            recording_id: id,
            error: err.message,
            timestamp: new Date().toISOString(),
          })
        );
      }
    }
  }

  return { recovered, failed };
}
