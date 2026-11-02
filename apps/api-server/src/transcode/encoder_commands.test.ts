import { describe, it, expect } from "vitest";
import { buildEncoderArgs, resolveEncoderPreset } from "./pipeline.js";

describe("FFmpeg Encoder Commands Specification", () => {
  it("resolves user presets correctly", () => {
    // NVENC
    expect(resolveEncoderPreset("av1_nvenc", "p7")).toBe("p7");
    expect(resolveEncoderPreset("hevc_nvenc", "p2")).toBe("p2");
    expect(resolveEncoderPreset("hevc_nvenc", "invalid")).toBe("p5");

    // x265
    expect(resolveEncoderPreset("libx265", "slow")).toBe("slow");
    expect(resolveEncoderPreset("libx265", "veryslow")).toBe("veryslow");
    expect(resolveEncoderPreset("libx265", "invalid")).toBe("medium");

    // libsvtav1
    expect(resolveEncoderPreset("libsvtav1", "4")).toBe("4");
    expect(resolveEncoderPreset("libsvtav1", "10")).toBe("10");
    expect(resolveEncoderPreset("libsvtav1", "invalid")).toBe("7");
  });

  it("builds correct command for av1_nvenc", () => {
    const args = buildEncoderArgs({
      encoder: "av1_nvenc",
      preset: "p6",
      cqOrCrf: 32,
      inputPath: "input.mp4",
      outputPath: "output.mp4",
    });

    const cmd = `ffmpeg ${args.join(" ")}`;
    expect(cmd).toContain("-hwaccel cuda -hwaccel_output_format cuda -i input.mp4");
    expect(cmd).toContain('-vf scale_cuda=format=p010le');
    expect(cmd).toContain("-c:v av1_nvenc");
    expect(cmd).toContain("-preset p6");
    expect(cmd).toContain("-tune hq");
    expect(cmd).toContain("-rc vbr");
    expect(cmd).toContain("-cq 32");
    expect(cmd).toContain("-b:v 0");
    expect(cmd).toContain("-spatial-aq 1");
    expect(cmd).toContain("-temporal-aq 0");
    expect(cmd).toContain("-g 120");
    expect(cmd).toContain("-fps_mode passthrough");
    expect(cmd).toContain("-c:a copy");
    expect(cmd).toContain("output.mp4");
  });

  it("builds correct command for hevc_nvenc", () => {
    const args = buildEncoderArgs({
      encoder: "hevc_nvenc",
      preset: "p4",
      cqOrCrf: 28,
      inputPath: "input.mp4",
      outputPath: "output.mp4",
    });

    const cmd = `ffmpeg ${args.join(" ")}`;
    expect(cmd).toContain("-hwaccel cuda -hwaccel_output_format cuda -i input.mp4");
    expect(cmd).toContain('-vf scale_cuda=format=p010le');
    expect(cmd).toContain("-c:v hevc_nvenc");
    expect(cmd).toContain("-preset p4");
    expect(cmd).toContain("-tune hq");
    expect(cmd).toContain("-rc vbr");
    expect(cmd).toContain("-cq 28");
    expect(cmd).toContain("-b:v 0");
    expect(cmd).toContain("-spatial-aq 1");
    expect(cmd).toContain("-temporal-aq 0");
    expect(cmd).toContain("-g 120");
    expect(cmd).toContain("-tag:v hvc1");
    expect(cmd).toContain("-fps_mode passthrough");
    expect(cmd).toContain("-c:a copy");
    expect(cmd).toContain("output.mp4");
  });

  it("builds correct command for libx265", () => {
    const args = buildEncoderArgs({
      encoder: "libx265",
      preset: "fast",
      cqOrCrf: 26,
      inputPath: "input.mp4",
      outputPath: "output.mp4",
    });

    const cmd = `ffmpeg ${args.join(" ")}`;
    expect(cmd).toContain("-i input.mp4");
    expect(cmd).toContain("-c:v libx265");
    expect(cmd).toContain("-preset fast");
    expect(cmd).toContain("-crf 26");
    expect(cmd).toContain("-tag:v hvc1");
    expect(cmd).toContain("-fps_mode passthrough");
    expect(cmd).toContain("-c:a copy");
    expect(cmd).toContain("output.mp4");
  });

  it("builds correct command for libsvtav1", () => {
    const args = buildEncoderArgs({
      encoder: "libsvtav1",
      preset: "8",
      cqOrCrf: 30,
      inputPath: "input.mp4",
      outputPath: "output.mp4",
    });

    const cmd = `ffmpeg ${args.join(" ")}`;
    expect(cmd).toContain("-i input.mp4");
    expect(cmd).toContain("-c:v libsvtav1");
    expect(cmd).toContain("-preset 8");
    expect(cmd).toContain("-crf 30");
    expect(cmd).toContain("-fps_mode passthrough");
    expect(cmd).toContain("-c:a copy");
    expect(cmd).toContain("output.mp4");
  });
});

