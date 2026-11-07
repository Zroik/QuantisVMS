import { describe, it, expect } from "vitest";
import { parseTimestampFromFilename, sanitizeExitDiagnostics } from "./supervisor.js";

describe("Supervisor diagnostics", () => {
  it("includes exit code, signal and the stderr tail", () => {
    const text = sanitizeExitDiagnostics(1, null, "line one\nline two\n");
    expect(text).toContain("code=1");
    expect(text).toContain("signal=null");
    expect(text).toContain("line two");
  });

  it("parses filenames with the per-boot PID suffix", () => {
    const ts = parseTimestampFromFilename("20261103_120000_12345.mp4");
    expect(ts?.toISOString()).toBe("2026-11-03T12:00:00.000Z");
  });

  it("still parses legacy filenames", () => {
    const ts = parseTimestampFromFilename("20261103_120000.mp4");
    expect(ts?.toISOString()).toBe("2026-11-03T12:00:00.000Z");
  });

  it("parses merged filenames with and without underscore", () => {
    const ts1 = parseTimestampFromFilename("20261105_060000_merged.mp4");
    expect(ts1?.toISOString()).toBe("2026-11-05T06:00:00.000Z");

    const ts2 = parseTimestampFromFilename("20261105060000_merged.mp4");
    expect(ts2?.toISOString()).toBe("2026-11-05T06:00:00.000Z");
  });
});
