import type { Pool } from "mysql2/promise";
import type { Redis } from "ioredis";
import path from "node:path";
import { FFmpegSupervisor } from "./supervisor.js";
import { probeVideo } from "./probe.js";
import { reconcileOrphanRecordings } from "./reconciler.js";

export interface RecorderOptions {
  pool: Pool;
  redis?: Redis | null;
  rawDir?: string;
  segmentSec?: number;
}

function safePublish(redis: Redis | null | undefined, channel: string, payload: string): void {
  if (!redis) return;
  void redis.publish(channel, payload).catch((err) => {
    console.error(`[Recorder] Redis publish failed on ${channel}:`, err);
  });
}

export class RecorderService {
  private supervisors = new Map<number, FFmpegSupervisor>();
  private activeRecordingIds = new Map<string, number>(); // raw_path -> recording_id
  private cameraOps = new Map<number, Promise<unknown>>();
  private isRunning = false;

  constructor(private readonly options: RecorderOptions) {}

  private withCameraLock<T>(cameraId: number, fn: () => Promise<T>): Promise<T> {
    const previous = (this.cameraOps.get(cameraId) as Promise<unknown> | undefined) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    const tracked = next.finally(() => {
      if (this.cameraOps.get(cameraId) === tracked) {
        this.cameraOps.delete(cameraId);
      }
    });
    this.cameraOps.set(cameraId, tracked);
    return next;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Gate G3.7: Startup reconciliation of mid-file crashes
    await reconcileOrphanRecordings(this.options.pool, this.options.redis, this.options.rawDir);
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    await Promise.all(
      [...this.supervisors.values()].map((supervisor) =>
        supervisor.stop().catch((err) => console.error("[Recorder] Supervisor stop failed:", err))
      )
    );
    this.supervisors.clear();
    this.activeRecordingIds.clear();
  }

  public getSupervisor(cameraId: number): FFmpegSupervisor | undefined {
    return this.supervisors.get(cameraId);
  }

  public setSegmentSec(sec: number): void {
    this.options.segmentSec = sec;
    for (const supervisor of this.supervisors.values()) {
      supervisor.config.segmentSec = sec;
    }
  }

  public async registerCamera(cameraId: number, rtspUrl: string): Promise<FFmpegSupervisor> {
    return this.withCameraLock(cameraId, async () => {
      const existing = this.supervisors.get(cameraId);
      if (existing) {
        this.supervisors.delete(cameraId);
        await existing.stop();
      }

      const rawDir = path.resolve(this.options.rawDir || process.env.RAW_DIR || "data/raw");
      const camDir = path.join(rawDir, `cam${cameraId}`);

      const supervisor = new FFmpegSupervisor({
        cameraId,
        rtspUrl,
        outputDir: camDir,
        segmentSec: this.options.segmentSec || Number(process.env.SEGMENT_SEC) || 3600,
        redis: this.options.redis,
        onNewSegment: async (filePath, startedAt) => {
          await this.handleNewSegment(cameraId, filePath, startedAt);
        },
        onFinalizeSegment: async (filePath) => {
          await this.handleFinalizeSegment(cameraId, filePath);
        },
      });

      this.supervisors.set(cameraId, supervisor);
      await supervisor.start();
      return supervisor;
    });
  }

  public async unregisterCamera(cameraId: number): Promise<void> {
    return this.withCameraLock(cameraId, async () => {
      const supervisor = this.supervisors.get(cameraId);
      if (supervisor) {
        this.supervisors.delete(cameraId);
        await supervisor.stop();
      }
    });
  }

  public async handleNewSegment(cameraId: number, filePath: string, startedAt: Date): Promise<number> {
    const [result] = await this.options.pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status)
       VALUES (?, ?, ?, 'RECORDING')`,
      [cameraId, startedAt, filePath]
    );

    const recordingId = result.insertId;
    this.activeRecordingIds.set(filePath, recordingId);

    if (this.options.redis) {
      safePublish(
        this.options.redis,
        "recording:status",
        JSON.stringify({ recording_id: recordingId, camera_id: cameraId, status: "RECORDING" })
      );
    }

    return recordingId;
  }

  public async handleFinalizeSegment(cameraId: number, filePath: string): Promise<void> {
    let recordingId = this.activeRecordingIds.get(filePath);

    if (!recordingId) {
      const [rows] = await this.options.pool.query<any[]>(
        "SELECT id FROM recordings WHERE raw_path = ? LIMIT 1",
        [filePath]
      );
      if (rows.length > 0) {
        recordingId = rows[0].id;
      }
    }

    if (!recordingId) return;

    let probe;
    try {
      probe = await probeVideo(filePath);
    } catch (probeErr: any) {
      // Only genuinely unreadable fragments are SKIPPED. Transient failures
      // (timeout/EACCES/EMFILE) leave the row RECORDING for the reconciler.
      const transient = /timed out|timeout|EACCES|EMFILE|ENFILE|EBUSY|EAGAIN/i.test(probeErr.message || "");
      if (transient) {
        console.error(`[Recorder:${cameraId}] Transient probe failure for #${recordingId}; leaving RECORDING:`, probeErr.message);
        return;
      }
      try {
        await this.options.pool.query(
          "UPDATE recordings SET status = 'SKIPPED', duration_sec = 0, failure_reason = ? WHERE id = ? AND status = 'RECORDING'",
          [`SKIPPED: Empty or unreadable fragment during teardown (${probeErr.message})`, recordingId]
        );
      } catch {}
      return;
    }

    try {
      if (probe.sizeBytes === 0 || (probe.durationSec <= 0 && (probe.nbReadPackets ?? 0) === 0)) {
        await this.options.pool.query(
          "UPDATE recordings SET status = 'SKIPPED', duration_sec = 0, failure_reason = ? WHERE id = ? AND status = 'RECORDING'",
          ["SKIPPED: Zero duration or zero decodable packets on segment finalize", recordingId]
        );
        this.activeRecordingIds.delete(filePath);
        return;
      }

      const [recRows] = await this.options.pool.query<any[]>(
        "SELECT started_at FROM recordings WHERE id = ?",
        [recordingId]
      );

      const startedAtTime = recRows.length > 0 ? new Date(recRows[0].started_at).getTime() : Date.now();
      const effectiveDurationSec =
        probe.durationSec > 0
          ? probe.durationSec
          : Math.max(1, Math.round((Date.now() - startedAtTime) / 1000));
      const endedAt = new Date(startedAtTime + Math.round(effectiveDurationSec * 1000));

      await this.options.pool.query(
        `UPDATE recordings SET
          status = 'RAW',
          ended_at = ?,
          duration_sec = ?,
          width = ?,
          height = ?,
          fps = ?,
          codec_raw = ?,
          raw_size_bytes = ?
        WHERE id = ? AND status = 'RECORDING'`,
        [
          endedAt,
          Math.round(effectiveDurationSec),
          probe.width,
          probe.height,
          probe.fps,
          probe.codec,
          probe.sizeBytes,
          recordingId,
        ]
      );

      this.activeRecordingIds.delete(filePath);

      if (this.options.redis) {
        safePublish(
          this.options.redis,
          "recording:status",
          JSON.stringify({ recording_id: recordingId, camera_id: cameraId, status: "RAW" })
        );
      }
    } catch (dbErr: any) {
      console.error(`[Recorder:${cameraId}] Database error updating finalized segment #${recordingId}:`, dbErr);
    }
  }
}

