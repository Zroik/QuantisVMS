import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  durationSec: number;
  durationKnown: boolean;
  nbReadPackets?: number;
  width: number;
  height: number;
  fps: number;
  fpsSource?: "avg_frame_rate" | "r_frame_rate" | "default";
  codec: string;
  sizeBytes: number;
}

function parseFrameRate(rawRate: unknown): number | null {
  if (typeof rawRate !== "string" || !rawRate.trim() || rawRate === "0/0" || rawRate === "N/A") {
    return null;
  }
  const parts = rawRate.split("/");
  if (parts.length === 2) {
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0 && num > 0) {
      return num / den;
    }
    return null;
  }
  const parsed = parseFloat(rawRate);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Runs ffprobe on a video file and parses video stream and format metadata (Spec §8.1).
 */
export async function probeVideo(filePath: string): Promise<ProbeResult> {
  const args = [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,avg_frame_rate,r_frame_rate,duration",
    "-show_entries", "format=duration,size",
    "-of", "json",
    filePath,
  ];

  const { stdout } = await execFileAsync("ffprobe", args, { timeout: 15000 });
  const data = JSON.parse(stdout);

  const stream = data.streams?.[0];
  const format = data.format;

  if (!stream && !format) {
    throw new Error(`ffprobe produced no stream or format information for ${filePath}`);
  }

  // Prefer avg_frame_rate over r_frame_rate (which can be 90000 timebase on RTSP streams)
  let fps = 25.0;
  let fpsSource: "avg_frame_rate" | "r_frame_rate" | "default" = "default";
  const avgFps = parseFrameRate(stream?.avg_frame_rate);
  const rFps = parseFrameRate(stream?.r_frame_rate);
  if (avgFps !== null && avgFps <= 240) {
    fps = avgFps;
    fpsSource = "avg_frame_rate";
  } else if (rFps !== null && rFps <= 240) {
    fps = rFps;
    fpsSource = "r_frame_rate";
  } else if (avgFps !== null) {
    fps = avgFps;
    fpsSource = "avg_frame_rate";
  } else if (rFps !== null) {
    fps = rFps;
    fpsSource = "r_frame_rate";
  }

  // Duration can be in format or stream, or "N/A" on interrupted fMP4 fragments
  const rawFormatDur = format?.duration;
  const rawStreamDur = stream?.duration;
  const parsedFormatDur =
    rawFormatDur !== undefined && rawFormatDur !== "N/A" ? parseFloat(String(rawFormatDur)) : NaN;
  const parsedStreamDur =
    rawStreamDur !== undefined && rawStreamDur !== "N/A" ? parseFloat(String(rawStreamDur)) : NaN;

  let durationSec = 0;
  let durationKnown = false;
  let nbReadPackets: number | undefined;

  if (Number.isFinite(parsedFormatDur) && parsedFormatDur > 0) {
    durationSec = parsedFormatDur;
    durationKnown = true;
  } else if (Number.isFinite(parsedStreamDur) && parsedStreamDur > 0) {
    durationSec = parsedStreamDur;
    durationKnown = true;
  } else {
    // Interrupted fMP4 lacks container mvhd duration; count decodable packets as fallback
    try {
      const countArgs = [
        "-v", "error",
        "-select_streams", "v:0",
        "-count_packets",
        "-show_entries", "stream=nb_read_packets",
        "-of", "json",
        filePath,
      ];
      const { stdout: countOut } = await execFileAsync("ffprobe", countArgs, { timeout: 20000 });
      const countData = JSON.parse(countOut);
      const packetsRaw = countData.streams?.[0]?.nb_read_packets;
      const packets = packetsRaw !== undefined ? parseInt(String(packetsRaw), 10) : 0;
      if (Number.isFinite(packets) && packets > 0) {
        nbReadPackets = packets;
        durationSec = Math.max(1, Number((packets / (fps > 0 ? fps : 25.0)).toFixed(2)));
        durationKnown = true;
      } else {
        nbReadPackets = 0;
      }
    } catch {
      durationKnown = false;
    }
  }

  const width = stream?.width ? parseInt(stream.width, 10) : 0;
  const height = stream?.height ? parseInt(stream.height, 10) : 0;
  const codec = stream?.codec_name || "unknown";
  const sizeBytes = format?.size ? parseInt(format.size, 10) : 0;

  return {
    durationSec,
    durationKnown,
    ...(nbReadPackets !== undefined ? { nbReadPackets } : {}),
    width,
    height,
    fps: Number(fps.toFixed(2)),
    fpsSource,
    codec,
    sizeBytes,
  };
}

