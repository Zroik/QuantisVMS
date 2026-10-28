import type { Pool, PoolConnection } from "mysql2/promise";

export type RecordingStatus =
  | "RECORDING"
  | "RAW"
  | "QUEUED"
  | "PROBING"
  | "ENCODING"
  | "VERIFYING"
  | "COMPLETED"
  | "SKIPPED"
  | "FAILED";

/**
 * Valid state transitions per Spec §7:
 * RECORDING → RAW → QUEUED → PROBING → ENCODING → VERIFYING → COMPLETED;
 * any step → FAILED (after retries);
 * VERIFYING → SKIPPED if no space gain;
 * FAILED/QUEUED → QUEUED on requeue.
 */
const ALLOWED_TRANSITIONS: Record<RecordingStatus, RecordingStatus[]> = {
  RECORDING: ["RAW", "FAILED"],
  RAW: ["QUEUED", "FAILED"],
  QUEUED: ["PROBING", "QUEUED", "FAILED"], // QUEUED -> QUEUED allows priority updates
  PROBING: ["ENCODING", "FAILED"],
  ENCODING: ["VERIFYING", "FAILED"],
  VERIFYING: ["COMPLETED", "SKIPPED", "FAILED"],
  COMPLETED: [], // Terminal state
  SKIPPED: ["QUEUED"], // Can be requeued if policy changes
  FAILED: ["QUEUED"], // Requeue allowed
};

export class IllegalStatusTransitionError extends Error {
  constructor(public readonly currentStatus: string, public readonly targetStatus: string, public readonly recordingId: number) {
    super(`Illegal status transition for recording ${recordingId}: cannot move from ${currentStatus} to ${targetStatus}`);
    this.name = "IllegalStatusTransitionError";
  }
}

export interface TransitionMetadata {
  ended_at?: Date;
  duration_sec?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec_raw?: string;
  raw_size_bytes?: number;
  compressed_path?: string;
  compressed_size_bytes?: number;
  optimal_cq?: number;
  vmaf_mean?: number;
  vmaf_p25?: number;
  quality_gate_met?: boolean | number;
  failure_reason?: string;
  attempts?: number;
  verified_at?: Date;
  raw_deleted_at?: Date;
}

/**
 * Enforces atomic state transitions in one function inside a DB transaction (Spec §7, Gate G4.3).
 * Rejects illegal moves by throwing IllegalStatusTransitionError.
 */
export async function transitionRecordingStatus(
  pool: Pool,
  recordingId: number,
  targetStatus: RecordingStatus,
  metadata: TransitionMetadata = {},
  existingConn?: PoolConnection
): Promise<{ previousStatus: RecordingStatus; currentStatus: RecordingStatus }> {
  const conn = existingConn || (await pool.getConnection());
  const shouldManageTransaction = !existingConn;

  try {
    if (shouldManageTransaction) {
      await conn.beginTransaction();
    }

    // Lock the row for update
    const [rows] = await conn.query<any[]>(
      "SELECT status FROM recordings WHERE id = ? FOR UPDATE",
      [recordingId]
    );

    if (rows.length === 0) {
      throw new Error(`Recording with id ${recordingId} not found`);
    }

    const currentStatus = rows[0].status as RecordingStatus;

    // Check legality of transition
    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      throw new IllegalStatusTransitionError(currentStatus, targetStatus, recordingId);
    }

    // Prepare update fields
    const updates: string[] = ["status = ?"];
    const params: any[] = [targetStatus];

    if (metadata.ended_at !== undefined) {
      updates.push("ended_at = ?");
      params.push(metadata.ended_at);
    }
    if (metadata.duration_sec !== undefined) {
      updates.push("duration_sec = ?");
      params.push(metadata.duration_sec);
    }
    if (metadata.width !== undefined) {
      updates.push("width = ?");
      params.push(metadata.width);
    }
    if (metadata.height !== undefined) {
      updates.push("height = ?");
      params.push(metadata.height);
    }
    if (metadata.fps !== undefined) {
      updates.push("fps = ?");
      params.push(metadata.fps);
    }
    if (metadata.codec_raw !== undefined) {
      updates.push("codec_raw = ?");
      params.push(metadata.codec_raw);
    }
    if (metadata.raw_size_bytes !== undefined) {
      updates.push("raw_size_bytes = ?");
      params.push(metadata.raw_size_bytes);
    }
    if (metadata.compressed_path !== undefined) {
      updates.push("compressed_path = ?");
      params.push(metadata.compressed_path);
    }
    if (metadata.compressed_size_bytes !== undefined) {
      updates.push("compressed_size_bytes = ?");
      params.push(metadata.compressed_size_bytes);
    }
    if (metadata.optimal_cq !== undefined) {
      updates.push("optimal_cq = ?");
      params.push(metadata.optimal_cq);
    }
    if (metadata.vmaf_mean !== undefined) {
      updates.push("vmaf_mean = ?");
      params.push(metadata.vmaf_mean);
    }
    if (metadata.vmaf_p25 !== undefined) {
      updates.push("vmaf_p25 = ?");
      params.push(metadata.vmaf_p25);
    }
    if (metadata.quality_gate_met !== undefined) {
      updates.push("quality_gate_met = ?");
      params.push(metadata.quality_gate_met ? 1 : 0);
    }
    if (metadata.failure_reason !== undefined) {
      updates.push("failure_reason = ?");
      params.push(metadata.failure_reason);
    }
    if (metadata.attempts !== undefined) {
      updates.push("attempts = ?");
      params.push(metadata.attempts);
    }
    if (metadata.verified_at !== undefined) {
      updates.push("verified_at = ?");
      params.push(metadata.verified_at);
    }
    if (metadata.raw_deleted_at !== undefined) {
      updates.push("raw_deleted_at = ?");
      params.push(metadata.raw_deleted_at);
    }

    params.push(recordingId);
    await conn.query(`UPDATE recordings SET ${updates.join(", ")} WHERE id = ?`, params);

    if (shouldManageTransaction) {
      await conn.commit();
    }

    return { previousStatus: currentStatus, currentStatus: targetStatus };
  } catch (err) {
    if (shouldManageTransaction) {
      await conn.rollback();
    }
    throw err;
  } finally {
    if (shouldManageTransaction) {
      conn.release();
    }
  }
}

