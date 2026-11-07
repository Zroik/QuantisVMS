import { describe, it, expect } from "vitest";
import { isRecordingPlayable, findNextPlayableIndex } from "./playback.js";

describe("Playback selectability", () => {
  it("treats a finished RAW segment with bytes as playable", () => {
    expect(isRecordingPlayable({ id: 1, status: "RAW", raw_size_bytes: 1024 })).toBe(true);
  });

  it("treats a COMPLETED segment with only a compressed artifact as playable", () => {
    expect(isRecordingPlayable({ id: 2, status: "COMPLETED", compressed_size_bytes: 4096 })).toBe(true);
  });

  it("rejects segments that are still recording, queued or empty", () => {
    expect(isRecordingPlayable({ id: 3, status: "RECORDING", raw_size_bytes: 1024 })).toBe(false);
    expect(isRecordingPlayable({ id: 4, status: "PROBING", raw_size_bytes: 1024 })).toBe(false);
    expect(isRecordingPlayable({ id: 5, status: "RAW", raw_size_bytes: 0 })).toBe(false);
    expect(isRecordingPlayable(null)).toBe(false);
  });

  it("honours an explicit playable flag from the API", () => {
    expect(isRecordingPlayable({ id: 6, status: "RECORDING", raw_size_bytes: 0, playable: true })).toBe(true);
    expect(isRecordingPlayable({ id: 7, status: "RAW", raw_size_bytes: 1024, playable: false })).toBe(false);
  });
});

describe("Playback auto-advance target", () => {
  const recordings = [
    { id: 10, status: "RAW", raw_size_bytes: 2048 },
    { id: 9, status: "RECORDING", raw_size_bytes: 512 },
    { id: 8, status: "COMPLETED", compressed_size_bytes: 2048 },
    { id: 7, status: "ERROR" },
  ];

  it("skips a segment that is still recording and lands on the next playable one", () => {
    expect(findNextPlayableIndex(recordings, 2)).toBe(0);
    expect(findNextPlayableIndex(recordings, 1)).toBe(0);
  });

  it("returns -1 when no older segment is playable", () => {
    expect(findNextPlayableIndex(recordings, 0)).toBe(-1);
    expect(findNextPlayableIndex([{ id: 7, status: "ERROR" }], 1)).toBe(-1);
  });

  it("walks past non-playable tails to reach a playable segment", () => {
    const withTail = [
      { id: 20, status: "RAW", raw_size_bytes: 1024 },
      { id: 19, status: "RECORDING" },
      { id: 18, status: "ERROR" },
    ];
    expect(findNextPlayableIndex(withTail, 2)).toBe(0);
  });
});
