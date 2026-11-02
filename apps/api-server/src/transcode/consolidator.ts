import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Pool } from "mysql2/promise";
import type { Redis } from "ioredis";

export interface ConsolidationResult {
  hoursConsolidated: number;
  segmentsMerged: number;
}

// In-process concurrency mutex to guarantee never running multiple consolidation loops simultaneously
let isConsolidating = false;

/**
 * Runs FFmpeg concat with strict execution timeout and SIGKILL guarantee.
 */
function runFfmpegConcat(args: string[], timeoutMs: number = 300000): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let isDone = false;

    const timer = setTimeout(() => {
      if (!isDone) {
        isDone = true;
        try {
          proc.kill("SIGKILL");
        } catch {}
        resolve({ exitCode: -1, stderr: `FFmpeg concat timed out after ${timeoutMs / 1000}s` });
      }
    }, timeoutMs);

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (!isDone) {
        isDone = true;
        clearTimeout(timer);
        resolve({ exitCode: code ?? 0, stderr });
      }
    });

    proc.on("error", (err) => {
      if (!isDone) {
        isDone = true;
        clearTimeout(timer);
        resolve({ exitCode: -1, stderr: err.message });
      }
    });
  });
}

/**
 * Probes a video file using ffprobe to get its duration in seconds.
 */
async function probeDurationSec(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { stdio: ["ignore", "pipe", "ignore"] });

    let stdout = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        const d = parseFloat(stdout.trim());
        resolve(isNaN(d) ? 0 : Math.round(d));
      } else {
        resolve(0);
      }
    });
    proc.on("error", () => resolve(0));
  });
}

/**
 * Cleans up orphaned or stale temporary files created during previous crashes or interrupted runs.
 * Cleans both scratch files in /data/tmp and any stray .tmp_*.mp4 files in /data/raw.
 */
export async function cleanupOrphanedConsolidatorFiles(dataDir: string = "/data", maxAgeMs: number = 600000): Promise<number> {
  let cleaned = 0;
  const cutoff = Date.now() - maxAgeMs;

  try {
    const tmpDir = path.join(dataDir, "tmp");
    if (fs.existsSync(tmpDir)) {
      const files = await fsp.readdir(tmpDir);
      for (const file of files) {
        if (file.startsWith("concat_") || file.startsWith("consolidate_")) {
          const fullPath = path.join(tmpDir, file);
          try {
            const st = await fsp.stat(fullPath);
            if (st.mtimeMs < cutoff) {
              await fsp.unlink(fullPath);
              cleaned++;
            }
          } catch {}
        }
      }
    }
  } catch {}

  try {
    const rawDir = path.join(dataDir, "raw");
    if (fs.existsSync(rawDir)) {
      const camDirs = await fsp.readdir(rawDir);
      for (const cam of camDirs) {
        const camPath = path.join(rawDir, cam);
        try {
          const st = await fsp.stat(camPath);
          if (!st.isDirectory()) continue;
          const files = await fsp.readdir(camPath);
          for (const file of files) {
            if (file.includes(".tmp_") || file.includes("_merged.mp4.tmp")) {
              const fullPath = path.join(camPath, file);
              try {
                await fsp.unlink(fullPath);
                cleaned++;
              } catch {}
            }
          }
        } catch {}
      }
    }
  } catch {}

  if (cleaned > 0) {
    console.log(`[Consolidator] Cleaned up ${cleaned} orphaned temporary consolidation files.`);
  }

  return cleaned;
}

/**
 * Consolidates fragmented segments from past completed clock hours into 1 lossless video.
 * e.g., if multiple files exist for 20:00:00 - 20:59:59, merges them into 1 MP4 with `-c copy`.
 * 
 * Safety guarantees:
 * 1. Single in-process execution via mutex `isConsolidating`.
 * 2. Distributed lock in Redis (`lock:consolidate:hourly:${cameraId}:${hourTimestamp}`) to prevent multi-worker collision.
 * 3. Writes intermediate stream to /data/tmp, NEVER directly to /data/raw.
 * 4. Automatic cleanup of failed or aborted temporary files.
 */
export async function consolidateHourlyRecordings(
  pool: Pool,
  dataDir: string = "/data",
  redis?: Redis
): Promise<ConsolidationResult> {
  if (isConsolidating) {
    return { hoursConsolidated: 0, segmentsMerged: 0 };
  }

  isConsolidating = true;
  let hoursConsolidated = 0;
  let segmentsMerged = 0;

  try {
    // Proactively clean up any stale temporary files
    await cleanupOrphanedConsolidatorFiles(dataDir, 600000);

    // Find hours in the past that have more than 1 non-recording segments
    const [groups] = await pool.query<any[]>(
      `SELECT camera_id,
              DATE_FORMAT(started_at, '%Y-%m-%d %H:00:00') as hour_bucket,
              COUNT(*) as segment_count
       FROM recordings
       WHERE status NOT IN ('RECORDING', 'FAILED')
         AND raw_path NOT LIKE '%_merged.mp4'
         AND started_at < DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00')
       GROUP BY camera_id, DATE_FORMAT(started_at, '%Y-%m-%d %H:00:00')
       HAVING segment_count > 1
       ORDER BY hour_bucket ASC`
    );

    for (const group of groups) {
      const cameraId = Number(group.camera_id);
      const hourBucket = group.hour_bucket;
      const hourTimestamp = hourBucket.replace(/[- :]/g, "").slice(0, 10) + "0000";

      // Distributed lock in Redis (TTL: 15 min / 900s)
      const lockKey = `lock:consolidate:hourly:${cameraId}:${hourTimestamp}`;
      let acquiredLock = false;
      if (redis) {
        try {
          const res = await redis.set(lockKey, String(process.pid), "EX", 900, "NX");
          if (!res) {
            console.log(`[Consolidator] Lock active for cam${cameraId} at ${hourBucket}, skipping.`);
            continue;
          }
          acquiredLock = true;
        } catch {
          // Fall through if redis lock check fails
        }
      }

      const tmpDir = path.join(dataDir, "tmp");
      await fsp.mkdir(tmpDir, { recursive: true });

      const listFilePath = path.join(tmpDir, `concat_${cameraId}_${hourTimestamp}_${Date.now()}.txt`);
      const tempOutputFile = path.join(tmpDir, `consolidate_${cameraId}_${hourTimestamp}_${Date.now()}.mp4`);
      const mergedFileName = `${hourTimestamp}_merged.mp4`;
      const mergedFilePath = path.join(dataDir, "raw", `cam${cameraId}`, mergedFileName);

      let mergeSuccess = false;

      try {
        // Fetch all segments in this hour bucket (exclude already merged outputs)
        const [segments] = await pool.query<any[]>(
          `SELECT id, raw_path, started_at, ended_at, duration_sec, raw_size_bytes
           FROM recordings
           WHERE camera_id = ?
             AND started_at >= ?
             AND started_at < DATE_ADD(?, INTERVAL 1 HOUR)
             AND status NOT IN ('RECORDING', 'FAILED')
             AND raw_path NOT LIKE '%_merged.mp4'
           ORDER BY started_at ASC`,
          [cameraId, hourBucket, hourBucket]
        );

        // Verify files on disk
        const validSegments: any[] = [];
        for (const seg of segments) {
          if (!seg.raw_path) continue;
          try {
            const st = await fsp.stat(seg.raw_path);
            if (st.size > 1000) {
              validSegments.push(seg);
            }
          } catch {}
        }

        if (validSegments.length <= 1) {
          continue;
        }

        const listLines = validSegments.map((s) => `file '${s.raw_path.replace(/'/g, "'\\''")}'`).join("\n");
        await fsp.writeFile(listFilePath, listLines, "utf-8");

        console.log(`[Consolidator] Merging ${validSegments.length} fragments for cam${cameraId} at ${hourBucket} -> ${mergedFilePath}...`);

        // Execute concat into isolated temp file in /data/tmp
        const concatRes = await runFfmpegConcat([
          "-hide_banner",
          "-y",
          "-loglevel", "warning",
          "-f", "concat",
          "-safe", "0",
          "-i", listFilePath,
          "-c", "copy",
          "-movflags", "+faststart",
          tempOutputFile,
        ], 300000);

        if (concatRes.exitCode !== 0) {
          console.warn(`[Consolidator] FFmpeg concat failed: ${concatRes.stderr}`);
          continue;
        }

        let mergedSize = 0;
        try {
          const st = await fsp.stat(tempOutputFile);
          mergedSize = st.size;
        } catch {}

        if (mergedSize <= 1000) {
          console.warn(`[Consolidator] Merged file was empty or too small, skipping.`);
          continue;
        }

        // Atomically move from tmp to destination
        await fsp.mkdir(path.dirname(mergedFilePath), { recursive: true });
        await fsp.rename(tempOutputFile, mergedFilePath);
        mergeSuccess = true;

        const exactDuration = await probeDurationSec(mergedFilePath);

        // Primary segment will become the merged segment
        const primary = validSegments[0];
        const otherSegments = validSegments.slice(1);
        const otherIds = otherSegments.map((s) => s.id);
        const lastSegment = validSegments[validSegments.length - 1];

        // Remove any spurious row created during writing
        await pool.query("DELETE FROM recordings WHERE raw_path = ? AND id != ?", [mergedFilePath, primary.id]);

        // Update primary recording row
        await pool.query(
          `UPDATE recordings
           SET raw_path = ?,
               ended_at = ?,
               duration_sec = ?,
               raw_size_bytes = ?,
               status = 'RAW',
               compressed_path = NULL,
               compressed_size_bytes = NULL,
               optimal_cq = NULL,
               vmaf_mean = NULL
           WHERE id = ?`,
          [mergedFilePath, lastSegment.ended_at || lastSegment.started_at, exactDuration, mergedSize, primary.id]
        );

        // Re-assign activity windows and probe logs to primary ID
        if (otherIds.length > 0) {
          await pool.query(
            `UPDATE recording_activity_windows SET recording_id = ? WHERE recording_id IN (?)`,
            [primary.id, otherIds]
          );
          await pool.query(
            `UPDATE vmaf_probe_logs SET recording_id = ? WHERE recording_id IN (?)`,
            [primary.id, otherIds]
          );
          // Delete superseded recording rows
          await pool.query(
            `DELETE FROM recordings WHERE id IN (?)`,
            [otherIds]
          );

          // Delete superseded raw files on disk (DO NOT delete mergedFilePath)
          for (const s of otherSegments) {
            if (s.raw_path && s.raw_path !== mergedFilePath) {
              try {
                await fsp.unlink(s.raw_path);
              } catch {}
            }
          }
          if (primary.raw_path && primary.raw_path !== mergedFilePath) {
            try {
              await fsp.unlink(primary.raw_path);
            } catch {}
          }
        }

        console.log(`[Consolidator] Successfully consolidated ${validSegments.length} segments into recording #${primary.id} (${exactDuration}s, ${(mergedSize / (1024 * 1024)).toFixed(1)} MB).`);
        hoursConsolidated++;
        segmentsMerged += validSegments.length;
      } finally {
        // Guaranteed cleanup of temp files
        try { await fsp.unlink(listFilePath); } catch {}
        if (!mergeSuccess) {
          try { await fsp.unlink(tempOutputFile); } catch {}
        }
        if (acquiredLock && redis) {
          try { await redis.del(lockKey); } catch {}
        }
      }
    }
  } catch (err: any) {
    console.error(`[Consolidator] Error during consolidation:`, err.message);
  } finally {
    isConsolidating = false;
  }

  return { hoursConsolidated, segmentsMerged };
}
