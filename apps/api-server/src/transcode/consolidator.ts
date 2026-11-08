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
 * Bounded tail-decode check for a merged artifact. Decoding the last few
 * seconds catches truncation/corruption that a duration probe can miss.
 */
function verifyTailDecodable(filePath: string, seconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    let stderr = "";
    const proc = spawn(
      "ffmpeg",
      ["-v", "error", "-sseof", `-${Math.max(1, Math.ceil(seconds))}`, "-i", filePath, "-f", "null", "-"],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => resolve(code === 0 && !stderr.trim()));
    proc.on("error", () => resolve(false));
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
                const st = await fsp.stat(fullPath);
                if (st.mtimeMs < cutoff) {
                  await fsp.unlink(fullPath);
                  cleaned++;
                }
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

    // Find hours in the past that have more than 1 RAW completed segments
    const [groups] = await pool.query<any[]>(
      `SELECT camera_id,
              DATE_FORMAT(started_at, '%Y-%m-%d %H:00:00') as hour_bucket,
              COUNT(*) as segment_count
       FROM recordings
       WHERE status = 'RAW'
         AND ended_at IS NOT NULL
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
      const datePart = hourTimestamp.slice(0, 8);
      const timePart = hourTimestamp.slice(8, 14);
      const mergedFileName = `${datePart}_${timePart}_merged.mp4`;
      const mergedFilePath = path.join(dataDir, "raw", `cam${cameraId}`, mergedFileName);

      let mergeSuccess = false;

      try {
        // Fetch all RAW segments in this hour bucket (exclude already merged outputs)
        const [segments] = await pool.query<any[]>(
          `SELECT id, raw_path, started_at, ended_at, duration_sec, raw_size_bytes
           FROM recordings
           WHERE camera_id = ?
             AND started_at >= ?
             AND started_at < DATE_ADD(?, INTERVAL 1 HOUR)
             AND status = 'RAW'
             AND ended_at IS NOT NULL
             AND raw_path NOT LIKE '%_merged.mp4'
           ORDER BY started_at ASC, id ASC`,
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

        // Never merge into an hour that already has a merged artifact: the
        // concat step would overwrite that file on disk and the primary-row
        // UPDATE would collide with the existing row's UNIQUE(raw_path).
        const [existingMerged] = await pool.query<any[]>(
          `SELECT id FROM recordings
           WHERE camera_id = ?
             AND started_at >= ?
             AND started_at < DATE_ADD(?, INTERVAL 1 HOUR)
             AND raw_path LIKE '%_merged.mp4'
           LIMIT 1`,
          [cameraId, hourBucket, hourBucket]
        );
        if (existingMerged.length > 0) {
          console.warn(`[Consolidator] Hour ${hourBucket} for cam${cameraId} already has a merged artifact, skipping to preserve it.`);
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

        // Validate the merged artifact before any source segment is unlinked.
        // Duration must be present and within tolerance of the sum of segments,
        // and the tail must decode cleanly; otherwise keep the originals.
        const expectedDurationSec = validSegments.reduce(
          (acc, segment) => acc + Number(segment.duration_sec || 0),
          0
        );
        const durationTolerance = Math.max(2, expectedDurationSec * 0.01);
        const durationValid =
          exactDuration > 0 &&
          (expectedDurationSec <= 0 || Math.abs(exactDuration - expectedDurationSec) <= durationTolerance);
        if (!durationValid) {
          console.warn(
            `[Consolidator] Merged duration ${exactDuration}s invalid vs expected ${expectedDurationSec}s for cam${cameraId} at ${hourBucket}; keeping originals.`
          );
          try {
            await fsp.unlink(mergedFilePath);
          } catch {}
          continue;
        }

        const decodable = await verifyTailDecodable(mergedFilePath, Math.min(10, exactDuration));
        if (!decodable) {
          console.warn(
            `[Consolidator] Merged file failed tail-decode validation for cam${cameraId} at ${hourBucket}; keeping originals.`
          );
          try {
            await fsp.unlink(mergedFilePath);
          } catch {}
          continue;
        }

        // Primary segment will become the merged segment
        const primary = validSegments[0];
        const otherSegments = validSegments.slice(1);
        const otherIds = otherSegments.map((s) => s.id);
        const lastSegment = validSegments[validSegments.length - 1];

        // Execute database updates inside a transaction with row-level locks
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();

          const allIds = validSegments.map((s) => s.id);
          const [lockedRows] = await conn.query<any[]>(
            `SELECT id, status FROM recordings WHERE id IN (?) FOR UPDATE`,
            [allIds]
          );

          // Guarantee that every candidate segment is still in RAW status
          const allRaw = lockedRows.length === allIds.length && lockedRows.every((r) => r.status === "RAW");
          if (!allRaw) {
            console.warn(`[Consolidator] Status changed concurrently for segments in cam${cameraId} at ${hourBucket}, rolling back and skipping.`);
            await conn.rollback();
            try { await fsp.unlink(mergedFilePath); } catch {}
            continue;
          }

          // Update primary recording row
          await conn.query(
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

          // Re-assign AI detection events, activity windows, and probe logs to primary ID
          if (otherIds.length > 0) {
            // [PH5-01] Reassign forensic AI events to primary ID before deleting other rows to prevent data loss (ON DELETE SET NULL)
            await conn.query(
              `UPDATE ai_detection_events SET recording_id = ? WHERE recording_id IN (?)`,
              [primary.id, otherIds]
            );

            // [PH5-03] Rebase and reassign activity windows for superseded segments to prevent ER_DUP_ENTRY on (recording_id, window_index)
            const [primaryWinRows] = await conn.query<any[]>(
              `SELECT COALESCE(MAX(window_index), -1) AS max_win_index FROM recording_activity_windows WHERE recording_id = ?`,
              [primary.id]
            );
            let currentBaseWinIndex = Number(primaryWinRows[0]?.max_win_index ?? -1) + 1;
            let cumulativeOffsetSec = primary.duration_sec || 0;

            for (let i = 1; i < validSegments.length; i++) {
              const seg = validSegments[i];
              const [segWindows] = await conn.query<any[]>(
                `SELECT id, window_index, start_offset_sec FROM recording_activity_windows WHERE recording_id = ? ORDER BY window_index ASC`,
                [seg.id]
              );

              for (const win of segWindows) {
                const newWinIndex = currentBaseWinIndex + win.window_index;
                const newOffsetSec = cumulativeOffsetSec + win.start_offset_sec;
                await conn.query(
                  `UPDATE recording_activity_windows
                   SET recording_id = ?, window_index = ?, start_offset_sec = ?, segment_index = ?
                   WHERE id = ?`,
                  [primary.id, newWinIndex, newOffsetSec, i, win.id]
                );
              }

              if (segWindows.length > 0) {
                currentBaseWinIndex += segWindows.length;
              }
              cumulativeOffsetSec += (seg.duration_sec || 0);
            }

            await conn.query(
              `UPDATE vmaf_probe_logs SET recording_id = ? WHERE recording_id IN (?)`,
              [primary.id, otherIds]
            );
            // Delete superseded recording rows
            await conn.query(
              `DELETE FROM recordings WHERE id IN (?)`,
              [otherIds]
            );
          }

          await conn.commit();
        } catch (txErr) {
          await conn.rollback();
          throw txErr;
        } finally {
          conn.release();
        }

        // Delete superseded raw files on disk only after transaction successfully committed
        if (otherIds.length > 0) {
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
