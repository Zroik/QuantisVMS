import { describe, it, expect } from "vitest";
import { selectProbeWindow, type ActivityWindow } from "./window-selection.js";

describe("Gate G4.1: Smart Probing Window Selection (Spec §8.3, Gate G4.1)", () => {
  const P = 600; // PROBE_INTERVAL_SEC
  const S = 20;  // PROBE_SAMPLE_SEC
  const expectedRows = P / S; // 30 windows

  it("item 1: selects ai_peak window with highest activity score", () => {
    const windows: ActivityWindow[] = Array.from({ length: expectedRows }, (_, i) => ({
      window_index: i,
      start_offset_sec: i * S,
      weighted_activity_score: i === 12 ? 42.5 : 0.0,
    }));

    const result = selectProbeWindow({
      chunkIndex: 0,
      chunkStartSec: 0,
      chunkDurationSec: P,
      sampleDurationSec: S,
      smartAiSampling: true,
      windows,
    });

    expect(result.samplingMode).toBe("ai_peak");
    expect(result.sampleStartSec).toBe(12 * S); // 240s
    expect(result.coverage).toBe(1.0);
    expect(result.selectedWindow?.weighted_activity_score).toBe(42.5);
  });

  it("item 2: resolves score ties by choosing earliest window", () => {
    const windows: ActivityWindow[] = Array.from({ length: expectedRows }, (_, i) => ({
      window_index: i,
      start_offset_sec: i * S,
      weighted_activity_score: i === 5 || i === 15 ? 30.0 : 5.0,
    }));

    const result = selectProbeWindow({
      chunkIndex: 0,
      chunkStartSec: 0,
      chunkDurationSec: P,
      sampleDurationSec: S,
      smartAiSampling: true,
      windows,
    });

    expect(result.samplingMode).toBe("ai_peak");
    // Window index 5 (offset 100s) should win over window index 15 (offset 300s)
    expect(result.sampleStartSec).toBe(5 * S);
  });

  it("item 3: coverage < 0.9 triggers blind_fallback even if high score exists", () => {
    // Only 20 windows provided out of 30 expected -> coverage = 0.667 < 0.9
    const windows: ActivityWindow[] = Array.from({ length: 20 }, (_, i) => ({
      window_index: i,
      start_offset_sec: i * S,
      weighted_activity_score: i === 3 ? 99.0 : 0.0,
    }));

    const result = selectProbeWindow({
      chunkIndex: 0,
      chunkStartSec: 0,
      chunkDurationSec: P,
      sampleDurationSec: S,
      smartAiSampling: true,
      windows,
    });

    expect(result.samplingMode).toBe("blind_fallback");
    expect(result.coverage).toBeLessThan(0.9);
    // Middle sample: (600 - 20) / 2 = 290
    expect(result.sampleStartSec).toBe(290);
  });

  it("item 4: all-zero activity with fresh static_cq_cache uses static_cache mode without probing", () => {
    const windows: ActivityWindow[] = Array.from({ length: expectedRows }, (_, i) => ({
      window_index: i,
      start_offset_sec: i * S,
      weighted_activity_score: 0.0,
    }));

    const now = new Date("2026-10-28T12:00:00Z");
    const cachedAt = new Date("2026-10-26T12:00:00Z"); // 2 days old (well under 7 days TTL)

    const result = selectProbeWindow({
      chunkIndex: 1,
      chunkStartSec: P,
      chunkDurationSec: P,
      sampleDurationSec: S,
      smartAiSampling: true,
      windows: windows.map((w) => ({ ...w, start_offset_sec: w.start_offset_sec + P })),
      staticCqCache: { cq: 32, cachedAt },
      staticCqTtlSec: 604800,
      now,
    });

    expect(result.samplingMode).toBe("static_cache");
    expect(result.cachedCq).toBe(32);
    expect(result.coverage).toBe(1.0);
  });

  it("item 5: all-zero activity with expired static_cq_cache falls back to blind_mid", () => {
    const windows: ActivityWindow[] = Array.from({ length: expectedRows }, (_, i) => ({
      window_index: i,
      start_offset_sec: i * S,
      weighted_activity_score: 0.0,
    }));

    const now = new Date("2026-10-28T12:00:00Z");
    const cachedAt = new Date("2026-10-10T12:00:00Z"); // 18 days old (> 7 days TTL)

    const result = selectProbeWindow({
      chunkIndex: 0,
      chunkStartSec: 0,
      chunkDurationSec: P,
      sampleDurationSec: S,
      smartAiSampling: true,
      windows,
      staticCqCache: { cq: 32, cachedAt },
      staticCqTtlSec: 604800,
      now,
    });

    expect(result.samplingMode).toBe("blind_mid");
    expect(result.sampleStartSec).toBe(290);
  });

  it("item 6: no rows provided results in blind_fallback", () => {
    const result = selectProbeWindow({
      chunkIndex: 0,
      chunkStartSec: 0,
      chunkDurationSec: P,
      sampleDurationSec: S,
      smartAiSampling: true,
      windows: [],
    });

    expect(result.samplingMode).toBe("blind_fallback");
    expect(result.coverage).toBe(0);
    expect(result.sampleStartSec).toBe(290);
  });

  it("item 7: smartAiSampling = false forces blind_mid regardless of activity or coverage", () => {
    const windows: ActivityWindow[] = Array.from({ length: expectedRows }, (_, i) => ({
      window_index: i,
      start_offset_sec: i * S,
      weighted_activity_score: 100.0,
    }));

    const result = selectProbeWindow({
      chunkIndex: 0,
      chunkStartSec: 0,
      chunkDurationSec: P,
      sampleDurationSec: S,
      smartAiSampling: false,
      windows,
    });

    expect(result.samplingMode).toBe("blind_mid");
    expect(result.sampleStartSec).toBe(290);
  });
});

