import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Redis } from "ioredis";

export interface SupervisorConfig {
  cameraId: number;
  rtspUrl: string;
  outputDir: string;
  segmentSec?: number;
  redis?: Redis | null;
  onNewSegment?: (filePath: string, startedAt: Date) => Promise<void>;
  onFinalizeSegment?: (filePath: string) => Promise<void>;
}

/**
 * Parses timestamp from segment filename YYYYMMDD_HHMMSS.mp4.
 */
export function parseTimestampFromFilename(filename: string): Date | null {
  const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/);
  if (!match) return null;

  const [_, year, month, day, hour, min, sec] = match;
  return new Date(
    Date.UTC(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(min, 10),
      parseInt(sec, 10)
    )
  );
}

/**
 * FFmpeg Supervisor for camera fragmented MP4 segmentation (Spec §8.1, §9.2, Gates G3.6, G3.7).
 */
export class FFmpegSupervisor extends EventEmitter {
  private childProcess: ChildProcess | null = null;
  private isRunning = false;
  private isStopping = false;
  private backoffSec = 1;
  private consecutiveFailures = 0;
  private stableTimer: NodeJS.Timeout | null = null;
  private restartTimeout: NodeJS.Timeout | null = null;
  private dirWatcher: fs.FSWatcher | null = null;
  private knownFiles = new Set<string>();
  private currentSegmentPath: string | null = null;

  constructor(public readonly config: SupervisorConfig) {
    super();
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isStopping = false;

    await fsp.mkdir(this.config.outputDir, { recursive: true });

    // Seed existing files in directory
    try {
      const existing = await fsp.readdir(this.config.outputDir);
      for (const f of existing) {
        if (f.endsWith(".mp4")) {
          this.knownFiles.add(path.join(this.config.outputDir, f));
        }
      }
    } catch {}

    this.startDirectoryWatch();
    this.spawnFfmpeg();
  }

  public async stop(): Promise<void> {
    this.isStopping = true;
    this.isRunning = false;

    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.dirWatcher) {
      this.dirWatcher.close();
      this.dirWatcher = null;
    }

    if (this.childProcess) {
      const proc = this.childProcess;
      this.childProcess = null;
      await new Promise<void>((resolve) => {
        proc.once("exit", () => resolve());
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 3000);
      });
    }

    if (this.currentSegmentPath && this.config.onFinalizeSegment) {
      await this.config.onFinalizeSegment(this.currentSegmentPath);
      this.currentSegmentPath = null;
    }
  }

  public getChildProcess(): ChildProcess | null {
    return this.childProcess;
  }

  public getBackoffSec(): number {
    return this.backoffSec;
  }

  public getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  private startDirectoryWatch(): void {
    try {
      this.dirWatcher = fs.watch(this.config.outputDir, async (_event, filename) => {
        if (!filename || !filename.endsWith(".mp4")) return;

        const fullPath = path.join(this.config.outputDir, filename);

        if (!this.knownFiles.has(fullPath)) {
          this.knownFiles.add(fullPath);

          // Finalize previous segment
          if (this.currentSegmentPath && this.currentSegmentPath !== fullPath) {
            const prevPath = this.currentSegmentPath;
            if (this.config.onFinalizeSegment) {
              await this.config.onFinalizeSegment(prevPath);
            }
          }

          // Register new segment
          this.currentSegmentPath = fullPath;
          const startedAt = parseTimestampFromFilename(filename) || new Date();
          if (this.config.onNewSegment) {
            await this.config.onNewSegment(fullPath, startedAt);
          }
          this.emit("segment:new", { filePath: fullPath, startedAt });
        }
      });
    } catch (err) {
      console.error(`[Supervisor:${this.config.cameraId}] Directory watch error:`, err);
    }
  }

  private spawnFfmpeg(): void {
    if (!this.isRunning || this.isStopping) return;

    const segmentSec = this.config.segmentSec || 60;
    const outputPattern = path.join(this.config.outputDir, "%Y%m%d_%H%M%S.mp4");

    const args = [
      "-hide_banner",
      "-loglevel", "warning",
      "-rtsp_transport", "tcp",
      "-i", this.config.rtspUrl,
      "-map", "0:v:0",
      "-an",
      "-c:v", "copy",
      "-f", "segment",
      "-segment_time", String(segmentSec),
      "-segment_atclocktime", "1",
      "-reset_timestamps", "1",
      "-strftime", "1",
      "-segment_format", "mp4",
      "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof",
      outputPattern,
    ];

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    this.childProcess = proc;
    this.emit("process:spawned", { pid: proc.pid });

    // Set 60s stable timer to reset backoff (Spec §8.1)
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = setTimeout(() => {
      this.backoffSec = 1;
      this.consecutiveFailures = 0;
    }, 60000);

    proc.on("exit", async (code, signal) => {
      if (this.stableTimer) {
        clearTimeout(this.stableTimer);
        this.stableTimer = null;
      }
      this.childProcess = null;
      this.emit("process:exit", { code, signal });

      if (this.isStopping) return;

      // Finalize active file when ffmpeg exits
      if (this.currentSegmentPath && this.config.onFinalizeSegment) {
        const finalizePath = this.currentSegmentPath;
        this.currentSegmentPath = null;
        await this.config.onFinalizeSegment(finalizePath);
      }

      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 5 && this.config.redis) {
        this.config.redis.publish(
          "system:alert",
          JSON.stringify({
            level: "critical",
            type: "camera_stream_offline",
            camera_id: this.config.cameraId,
            consecutive_failures: this.consecutiveFailures,
            timestamp: new Date().toISOString(),
          })
        );
      }

      // Schedule restart with exponential backoff (1s -> 30s)
      const currentDelay = this.backoffSec;
      this.backoffSec = Math.min(30, this.backoffSec * 2);

      this.restartTimeout = setTimeout(() => {
        if (this.isRunning && !this.isStopping) {
          this.spawnFfmpeg();
        }
      }, currentDelay * 1000);
    });
  }
}
