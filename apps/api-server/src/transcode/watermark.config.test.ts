import { describe, it, expect } from "vitest";
import { resolveWatermarkThresholds } from "./watermark.js";

describe("Disk watermark thresholds (X-02)", () => {
  it("does not become NaN when env vars are unset", () => {
    const { highWatermark, criticalWatermark } = resolveWatermarkThresholds({}, {});
    expect(highWatermark).toBe(85);
    expect(criticalWatermark).toBe(95);
  });

  it("uses finite env values", () => {
    const { highWatermark, criticalWatermark } = resolveWatermarkThresholds(
      {},
      { DISK_HIGH_WATERMARK_PCT: "70", DISK_CRITICAL_PCT: "90" }
    );
    expect(highWatermark).toBe(70);
    expect(criticalWatermark).toBe(90);
  });

  it("explicit options win", () => {
    const { highWatermark } = resolveWatermarkThresholds({ highWatermarkPct: 60 }, {});
    expect(highWatermark).toBe(60);
  });
});
