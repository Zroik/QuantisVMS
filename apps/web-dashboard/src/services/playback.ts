/**
 * Playback selectability rules shared by the Playback view and its tests.
 *
 * A recording is playable only when it has finished writing and has bytes on
 * disk. The API may also send an explicit `playable` flag, which wins.
 */
export const PLAYABLE_STATUSES = new Set(["RAW", "COMPLETED"]);

export interface PlayableRecording {
  id: number;
  status?: string;
  playable?: boolean;
  raw_size_bytes?: number | null;
  compressed_size_bytes?: number | null;
  has_compressed?: boolean;
}

export function isRecordingPlayable(rec: PlayableRecording | null | undefined): boolean {
  if (!rec) return false;
  if (typeof rec.playable === "boolean") return rec.playable;
  if (!PLAYABLE_STATUSES.has(rec.status || "")) return false;
  return (rec.compressed_size_bytes || 0) > 0 || (rec.raw_size_bytes || 0) > 0;
}

/**
 * Finds the next playable segment while walking the list backwards from
 * `fromIndex` (the list is ordered newest first). Returns -1 when no older
 * playable segment exists, so auto-advance never jumps onto a RECORDING or
 * failed segment.
 */
export function findNextPlayableIndex(
  recordings: Array<PlayableRecording | null | undefined>,
  fromIndex: number
): number {
  for (let index = fromIndex - 1; index >= 0; index--) {
    if (isRecordingPlayable(recordings[index])) return index;
  }
  return -1;
}
