import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import { calculateP25, calculatePercentile } from "./percentile.js";
import { parseVmafJson } from "./parser.js";
import {
  buildVmafArgs,
  runVmafWithFallback,
  type ProcessExecutor,
  type ProcessExecutionResult,
} from "./runner.js";

describe("VMAF Percentile (Gate G1.8 - NumPy Reference Parity)", () => {
  it("matches NumPy default linear interpolation on 4 elements [80, 85, 90, 95]", () => {
    // NumPy: np.percentile([80.0, 85.0, 90.0, 95.0], 25) = 83.75
    expect(calculateP25([80.0, 85.0, 90.0, 95.0])).toBe(83.75);
  });

  it("matches NumPy on 5 elements [10, 20, 30, 40, 50]", () => {
    // NumPy: np.percentile([10, 20, 30, 40, 50], 25) = 20.0
    expect(calculateP25([10.0, 20.0, 30.0, 40.0, 50.0])).toBe(20.0);
  });

  it("matches NumPy on single element array [88.5]", () => {
    // NumPy: np.percentile([88.5], 25) = 88.5
    expect(calculateP25([88.5])).toBe(88.5);
  });

  it("matches NumPy on 10 elements [70, 72, 75, 78, 80, 82, 85, 87, 90, 92]", () => {
    // NumPy: np.percentile([70, 72, 75, 78, 80, 82, 85, 87, 90, 92], 25) = 75.75
    const arr = [70, 72, 75, 78, 80, 82, 85, 87, 90, 92];
    expect(calculateP25(arr)).toBe(75.75);
  });

  it("handles unsorted input arrays properly", () => {
    const unsorted = [95.0, 80.0, 90.0, 85.0];
    expect(calculateP25(unsorted)).toBe(83.75);
  });

  it("throws on empty array", () => {
    expect(() => calculateP25([])).toThrow("Cannot calculate percentile of empty array");
  });
});

describe("VMAF JSON Parser (Spec §2 E5)", () => {
  it("parses valid libvmaf JSON output and computes p25 from per-frame scores", () => {
    const sampleJson = JSON.stringify({
      version: "3.0.0",
      fps: 25.0,
      pooled_metrics: {
        vmaf: {
          mean: 88.5,
          min: 80.0,
          max: 95.0,
          harmonic_mean: 87.8,
        },
      },
      frames: [
        { frameNum: 0, metrics: { vmaf: 80.0 } },
        { frameNum: 1, metrics: { vmaf: 85.0 } },
        { frameNum: 2, metrics: { vmaf: 90.0 } },
        { frameNum: 3, metrics: { vmaf: 95.0 } },
      ],
    });

    const result = parseVmafJson(sampleJson);
    expect(result.framesScored).toBe(4);
    expect(result.mean).toBe(88.5);
    expect(result.p25).toBe(83.75); // Linear interpolation on [80, 85, 90, 95]
    expect(result.min).toBe(80.0);
    expect(result.max).toBe(95.0);
    expect(result.hmean).toBe(87.8);
  });

  it("throws if no frames were scored", () => {
    const emptyFramesJson = JSON.stringify({
      frames: [],
    });
    expect(() => parseVmafJson(emptyFramesJson)).toThrow("zero scored frames");
  });
});

describe("VMAF Command Arguments (Spec §2 E7)", () => {
  it("places distorted video as input 0 [dist] and reference as input 1 [ref]", () => {
    const args = buildVmafArgs("dist.mp4", "ref.mp4", "log.json", "cuda");
    expect(args[args.indexOf("-i") + 1]).toBe("dist.mp4");
    expect(args[args.lastIndexOf("-i") + 1]).toBe("ref.mp4");

    const filterIdx = args.indexOf("-filter_complex");
    const filter = args[filterIdx + 1];
    expect(filter).toContain("[0:v]format=yuv420p,hwupload_cuda[dist]");
    expect(filter).toContain("[1:v]format=yuv420p,hwupload_cuda[ref]");
    expect(filter).toContain("[dist][ref]libvmaf_cuda");
  });

  it("builds CPU fallback filter with n_threads=16 and n_subsample=2", () => {
    const args = buildVmafArgs("dist.mp4", "ref.mp4", "log.json", "cpu");
    const filterIdx = args.indexOf("-filter_complex");
    const filter = args[filterIdx + 1];
    expect(filter).toContain("n_threads=16");
    expect(filter).toContain("n_subsample=2");
    expect(filter).toContain("libvmaf=");
  });
});

describe("VMAF Runner, Watchdog & Fallback (Gate G1.4, G1.5)", () => {
  const createMockVmafJson = (framesCount: number, meanScore = 88.0): string => {
    const frames = Array.from({ length: framesCount }, (_, i) => ({
      frameNum: i,
      metrics: { vmaf: meanScore },
    }));
    return JSON.stringify({
      pooled_metrics: { vmaf: { mean: meanScore } },
      frames,
    });
  };

  it("G1.4: Validates frames_scored == reference_frames and rejects frame mismatch", async () => {
    // Executor writes 490 frames when 500 frames are expected
    const fakeExecutor: ProcessExecutor = async (_cmd, args) => {
      const logArg = args.find((a) => a.includes("log_path="));
      const logPath = logArg?.split("log_path='")[1]?.split("'")[0] || "";
      if (logPath) {
        await fs.writeFile(logPath, createMockVmafJson(490));
      }
      return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
    };

    // Both CUDA and CPU output 490 instead of 500 -> entire run fails
    await expect(
      runVmafWithFallback("dist.mp4", "ref.mp4", {
        referenceFrames: 500,
        executor: fakeExecutor,
      })
    ).rejects.toThrow("VMAF calculation failed completely");
  });

  it("G1.5: Simulated CUDA hang times out, triggers CPU fallback, records backend='cpu'", async () => {
    let callCount = 0;

    const simulatedHangExecutor: ProcessExecutor = async (_cmd, args, timeoutMs) => {
      callCount++;
      const isCuda = args.some((a) => a.includes("libvmaf_cuda"));
      const logArg = args.find((a) => a.includes("log_path="));
      const logPath = logArg?.split("log_path='")[1]?.split("'")[0] || "";

      if (isCuda) {
        // Simulate CUDA hang: times out!
        return { exitCode: null, timedOut: true, stdout: "", stderr: "Hang simulated" };
      }

      // CPU fallback succeeds
      if (logPath) {
        await fs.writeFile(logPath, createMockVmafJson(500, 86.5));
      }
      return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
    };

    const result = await runVmafWithFallback("dist.mp4", "ref.mp4", {
      referenceFrames: 500,
      watchdogTimeoutMs: 100, // fast timeout for test
      executor: simulatedHangExecutor,
    });

    expect(result.backend).toBe("cpu");
    expect(result.framesScored).toBe(500);
    expect(result.mean).toBe(86.5);
    // CUDA attempt 1 (failed) -> CUDA retry (failed) -> CPU fallback (passed)
    expect(callCount).toBe(3);
  });
});
