import { describe, it, expect } from "vitest";
import { RECORDER_SERVICE_VERSION, formatSegmentFilename } from "./index.js";

describe("Recorder Service Skeleton", () => {
  it("exports correct version", () => {
    expect(RECORDER_SERVICE_VERSION).toBe("1.0.0");
  });

  it("formats segment filename in UTC YYYYMMDD_HHMMSS.mp4", () => {
    const fixedDate = new Date(Date.UTC(2026, 9, 28, 12, 30, 45));
    expect(formatSegmentFilename(fixedDate)).toBe("20261028_123045.mp4");
  });
});

