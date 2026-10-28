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

export class RecorderService {
  private supervisors = new Map<number, FFmpegSupervisor>();
  private activeRecordingIds = new Map<string, number>(); // raw_path -> recording_id
  private isRunning = false;

  constructor(private readonly options: RecorderOptions) {}

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Gate G3.7: Startup reconciliation of mid-file crashes
    await reconcileOrphanRecordings(this.options.pool, this.options.redis);
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    for (const supervisor of this.supervisors.values()) {
      await supervisor.stop();
    }
    this.supervisors.clear();
    this.activeRecordingIds.clear();
  }

  public getSupervisor(cameraId: number): FFmpegSupervisor | undefined {
    return this.supervisors.get(cameraId);
  }

  public async registerCamera(cameraId: number, rtspUrl: string): Promise<FFmpegSupervisor> {
    const rawDir = path.resolve(this.options.rawDir || process.env.RAW_DIR || "data/raw");
    const camDir = path.join(rawDir, `cam${cameraId}`);

    const supervisor = new FFmpegSupervisor({
      cameraId,
      rtspUrl,
      outputDir: camDir,
      segmentSec: this.options.segmentSec || Number(process.env.SEGMENT_SEC) || 60,
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
  }

  public async unregisterCamera(cameraId: number): Promise<void> {
    const supervisor = this.supervisors.get(cameraId);
    if (supervisor) {
      await supervisor.stop();
      this.supervisors.delete(cameraId);
    }
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
      this.options.redis.publish(
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

    try {
      const probe = await probeVideo(filePath);
      const [recRows] = await this.options.pool.query<any[]>(
        "SELECT started_at FROM recordings WHERE id = ?",
        [recordingId]
      );

      const startedAtTime = recRows.length > 0 ? new Date(recRows[0].started_at).getTime() : Date.now();
      const endedAt = new Date(startedAtTime + Math.round(probe.durationSec * 1000));

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
        WHERE id = ?`,
        [
          endedAt,
          Math.round(probe.durationSec),
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
        this.options.redis.publish(
          "recording:status",
          JSON.stringify({ recording_id: recordingId, camera_id: cameraId, status: "RAW" })
        );
      }
    } catch (err: any) {
      await this.options.pool.query(
        "UPDATE recordings SET status = 'FAILED', failure_reason = ? WHERE id = ?",
        [`Probe failure on finalize: ${err.message}`, recordingId]
      );
    }
  }
}

