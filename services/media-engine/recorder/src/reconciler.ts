import type { Pool } from "mysql2/promise";
import type { Redis } from "ioredis";
import path from "node:path";
import fs from "node:fs/promises";
import { probeVideo } from "./probe.js";
import { parseTimestampFromFilename } from "./supervisor.js";

/**
 * Startup Reconciler (Spec §8.1, Gate G3.7).
 * Reconciles abandoned recordings with status RECORDING.
 * Fragmented MP4 files retain readable content up to the crash moment.
 */
export async function reconcileOrphanRecordings(
  pool: Pool,
  redis?: Redis | null,
  rawDir: string = process.env.RAW_DIR || "data/raw"
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
        // Documented SKIPPED per Spec §12 Gate G6.2 / Decision D-006
        await pool.query(
          `UPDATE recordings SET
            status = 'SKIPPED',
            duration_sec = 0,
            failure_reason = 'SKIPPED: Zero duration fragment recovered after crash'
          WHERE id = ?`,
          [id]
        );
        failed++;
      }
    } catch (err: any) {
      // Documented SKIPPED per Spec §12 Gate G6.2 / Decision D-006
      await pool.query(
        `UPDATE recordings SET
          status = 'SKIPPED',
          duration_sec = 0,
          failure_reason = ?
        WHERE id = ?`,
        [`SKIPPED: Empty or unreadable fragment after hard kill (${err.message})`, id]
      );
      failed++;

      if (redis) {
        try {
          await redis.publish(
            "system:alert",
            JSON.stringify({
              level: "warn",
              type: "recording_recovery_skipped",
              recording_id: id,
              reason: err.message,
              timestamp: new Date().toISOString(),
            })
          );
        } catch (publishErr) {
          console.error("[Reconciler] Redis publish failed:", publishErr);
        }
      }
    }
  }

  // Reverse pass: scan data/raw for orphan MP4 files on disk with no DB row
  try {
    const rawRoot = path.resolve(rawDir);
    const entries = await fs.readdir(rawRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("cam")) {
        const cameraId = parseInt(entry.name.replace("cam", ""), 10);
        if (isNaN(cameraId)) continue;
        const camDir = path.join(rawRoot, entry.name);
        const files = await fs.readdir(camDir).catch(() => []);
        for (const file of files) {
          if (!file.endsWith(".mp4") || file.includes("_merged") || file.startsWith(".")) continue;
          const fullPath = path.join(camDir, file);
          const [existing] = await pool.query<any[]>(
            "SELECT id FROM recordings WHERE raw_path = ? LIMIT 1",
            [fullPath]
          );
          if (existing.length === 0) {
            try {
              const probe = await probeVideo(fullPath);
              if (probe.durationSec > 0) {
                const startedAt = parseTimestampFromFilename(file) || new Date();
                const endedAt = new Date(startedAt.getTime() + Math.round(probe.durationSec * 1000));
                await pool.query(
                  `INSERT INTO recordings (camera_id, started_at, ended_at, duration_sec, width, height, fps, codec_raw, raw_size_bytes, raw_path, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RAW')`,
                  [
                    cameraId,
                    startedAt,
                    endedAt,
                    Math.round(probe.durationSec),
                    probe.width,
                    probe.height,
                    probe.fps,
                    probe.codec,
                    probe.sizeBytes,
                    fullPath,
                  ]
                );
                recovered++;
              }
            } catch {
              failed++;
            }
          }
        }
      }
    }
  } catch {}

  return { recovered, failed };
}

