import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Redis } from "ioredis";

export function sanitizeExitDiagnostics(code: number | null, signal: NodeJS.Signals | null, stderrTail: string): string {
  const lines = stderrTail.split(/\r?\n/).filter(Boolean).slice(-20);
  return `code=${code ?? "null"} signal=${signal ?? "null"}${lines.length ? ` stderr=${lines.join(" | ")}` : ""}`;
}

function safePublish(redis: Redis | null | undefined, channel: string, payload: string): void {
  if (!redis) return;
  void redis.publish(channel, payload).catch((err) => {
    console.error(`[Supervisor] Redis publish failed on ${channel}:`, err);
  });
}

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
  const match = filename.match(/(\d{4})(\d{2})(\d{2})_?(\d{2})(\d{2})(\d{2})(?:_\d+|_merged)*\.mp4$/);
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
  private dirPoller: NodeJS.Timeout | null = null;
  private knownFiles = new Set<string>();
  private currentSegmentPath: string | null = null;
  private stderrTail = "";
  private alertSent = false;
  private restartScheduled = false;
  private spawnSeq = 0;
  private fileEventChain: Promise<void> = Promise.resolve();

  private enqueueFileEvent(task: () => Promise<void>): void {
    // Serialize filesystem events so two discoveries cannot race the
    // currentSegmentPath promotion (which could strand the newest segment).
    this.fileEventChain = this.fileEventChain
      .then(task)
      .catch((err) =>
        console.error(`[Supervisor:${this.config.cameraId}] File event error:`, err)
      );
  }

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
    if (this.dirPoller) {
      clearInterval(this.dirPoller);
      this.dirPoller = null;
    }

    if (this.childProcess) {
      const proc = this.childProcess;
      this.childProcess = null;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(killTimer);
          clearTimeout(settleTimer);
          resolve();
        };
        const killTimer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {}
        }, 3000);
        const settleTimer = setTimeout(finish, 5000);
        killTimer.unref?.();
        settleTimer.unref?.();
        proc.once("exit", finish);
        try {
          proc.kill("SIGTERM");
        } catch {
          finish();
        }
      });
    }

    if (this.currentSegmentPath && this.config.onFinalizeSegment) {
      const finalizePath = this.currentSegmentPath;
      this.currentSegmentPath = null;
      try {
        await this.config.onFinalizeSegment(finalizePath);
      } catch (err) {
        console.error(`[Supervisor:${this.config.cameraId}] Finalize on stop failed:`, err);
      }
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

  private async processNewFile(filename: string): Promise<void> {
    if (!filename || !filename.endsWith(".mp4") || filename.includes("_merged") || filename.startsWith(".")) return;

    const fullPath = path.join(this.config.outputDir, filename);

    if (!this.knownFiles.has(fullPath)) {
      this.knownFiles.add(fullPath);

      // Finalize the previous segment BEFORE promoting the new one. If we
      // promoted first, an ffmpeg exit during the await could finalize the
      // brand-new (still empty) file and leave it stuck RECORDING.
      if (this.currentSegmentPath && this.currentSegmentPath !== fullPath) {
        const prevPath = this.currentSegmentPath;
        if (this.config.onFinalizeSegment) {
          try {
            await this.config.onFinalizeSegment(prevPath);
          } catch (err) {
            console.error(`[Supervisor:${this.config.cameraId}] Error finalizing previous segment:`, err);
          }
        }
      }
      this.currentSegmentPath = fullPath;

      // Register new segment
      const startedAt = parseTimestampFromFilename(filename) || new Date();
      if (this.config.onNewSegment) {
        try {
          await this.config.onNewSegment(fullPath, startedAt);
        } catch (err) {
          console.error(`[Supervisor:${this.config.cameraId}] Error registering new segment:`, err);
        }
      }
      this.emit("segment:new", { filePath: fullPath, startedAt });
    }
  }

  private startDirectoryWatch(): void {
    try {
      this.dirWatcher = fs.watch(this.config.outputDir, (_event, filename) => {
        if (filename) {
          this.enqueueFileEvent(() => this.processNewFile(filename));
        }
      });
      this.dirWatcher.on("error", (err) => {
        console.error(`[Supervisor:${this.config.cameraId}] Directory watch error; relying on poller:`, err);
        this.dirWatcher?.close();
        this.dirWatcher = null;
      });
    } catch (err) {
      console.error(`[Supervisor:${this.config.cameraId}] Directory watch error:`, err);
    }

    // Polling fallback every 1000ms for robust cross-filesystem detection (e.g. WSL bind mounts)
    this.dirPoller = setInterval(() => {
      this.enqueueFileEvent(async () => {
        try {
          const files = await fsp.readdir(this.config.outputDir);
          for (const file of files) {
            await this.processNewFile(file);
          }
        } catch {}
      });
    }, 1000);
  }

  private spawnFfmpeg(): void {
    if (!this.isRunning || this.isStopping) return;
    this.restartScheduled = false;

    const segmentSec = this.config.segmentSec || 60;
    // A per-spawn sequence (plus PID) prevents same-second restarts from
    // overwriting a segment: ffmpeg silently truncates an existing target.
    this.spawnSeq += 1;
    const outputPattern = path.join(
      this.config.outputDir,
      `%Y%m%d_%H%M%S_${process.pid}_${this.spawnSeq}.mp4`
    );

    const args = [
      "-hide_banner",
      "-loglevel", "warning",
      "-rtsp_transport", "tcp",
      "-timeout", "10000000",
      "-i", this.config.rtspUrl,
      "-map", "0:v:0",
      "-an",
      "-c:v", "copy",
      "-f", "segment",
      "-segment_time", String(segmentSec),
      "-reset_timestamps", "1",
      "-strftime", "1",
      "-segment_format", "mp4",
      "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof+global_sidx",
      outputPattern,
    ];

    const proc = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        TZ: "UTC",
      },
    });
    this.childProcess = proc;
    this.stderrTail = "";
    this.emit("process:spawned", { pid: proc.pid });

    // Drain stdout and stderr to prevent OS pipe deadlock
    proc.stdout?.resume();
    proc.stderr?.on("data", (chunk) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-8192);
    });

    const scheduleRestart = (reason: string) => {
      if (this.isStopping || !this.isRunning || this.restartScheduled) return;
      this.restartScheduled = true;
      const currentDelay = this.backoffSec;
      this.backoffSec = Math.min(30, this.backoffSec * 2);
      this.restartTimeout = setTimeout(() => {
        if (this.isRunning && !this.isStopping) this.spawnFfmpeg();
      }, currentDelay * 1000);
      const delaySec = currentDelay;
      console.error(
        `[Supervisor:${this.config.cameraId}] ${reason}; restarting in ${delaySec}s (failures=${this.consecutiveFailures})`
      );
    };

    proc.on("error", (err) => {
      console.error(`[Supervisor:${this.config.cameraId}] FFmpeg spawn error:`, err);
      this.childProcess = null;
      this.consecutiveFailures++;
      this.emit("process:error", err);
      scheduleRestart(`spawn error: ${err.message}`);
    });

    // Set 60s stable timer to reset backoff (Spec §8.1)
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = setTimeout(() => {
      this.backoffSec = 1;
      this.consecutiveFailures = 0;
      this.alertSent = false;
    }, 60000);

    proc.on("exit", async (code, signal) => {
      try {
        if (this.stableTimer) {
          clearTimeout(this.stableTimer);
          this.stableTimer = null;
        }
        this.childProcess = null;
        this.emit("process:exit", { code, signal });

        if (this.isStopping) return;

        const diagnostics = sanitizeExitDiagnostics(code, signal, this.stderrTail);
        console.error(`[Supervisor:${this.config.cameraId}] FFmpeg exited unexpectedly (${diagnostics})`);

        // Finalize active file when ffmpeg exits
        if (this.currentSegmentPath && this.config.onFinalizeSegment) {
          const finalizePath = this.currentSegmentPath;
          this.currentSegmentPath = null;
          try {
            await this.config.onFinalizeSegment(finalizePath);
          } catch (err) {
            console.error(`[Supervisor:${this.config.cameraId}] Finalize on exit failed:`, err);
          }
        }

        this.consecutiveFailures++;
      } catch (err) {
        console.error(`[Supervisor:${this.config.cameraId}] Error in FFmpeg exit handler:`, err);
      } finally {
        if (!this.isStopping && this.isRunning) {
          if (this.consecutiveFailures >= 5 && !this.alertSent && this.config.redis) {
            this.alertSent = true;
            safePublish(
              this.config.redis,
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
          scheduleRestart("FFmpeg exited unexpectedly");
        }
      }
    });
  }
}

