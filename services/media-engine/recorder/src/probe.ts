import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  sizeBytes: number;
}

/**
 * Runs ffprobe on a video file and parses video stream and format metadata (Spec §8.1).
 */
export async function probeVideo(filePath: string): Promise<ProbeResult> {
  const args = [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,duration",
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

  // Duration can be in format or stream
  const rawDuration = parseFloat(format?.duration || stream?.duration || "0");
  const durationSec = isNaN(rawDuration) ? 0 : rawDuration;

  // FPS can be "25/1" or "30000/1001" or float
  let fps = 25.0;
  if (stream?.r_frame_rate) {
    const parts = stream.r_frame_rate.split("/");
    if (parts.length === 2 && parseFloat(parts[1]) > 0) {
      fps = parseFloat(parts[0]) / parseFloat(parts[1]);
    } else {
      fps = parseFloat(stream.r_frame_rate) || 25.0;
    }
  }

  const width = stream?.width ? parseInt(stream.width, 10) : 0;
  const height = stream?.height ? parseInt(stream.height, 10) : 0;
  const codec = stream?.codec_name || "unknown";
  const sizeBytes = format?.size ? parseInt(format.size, 10) : 0;

  return {
    durationSec,
    width,
    height,
    fps: Number(fps.toFixed(2)),
    codec,
    sizeBytes,
  };
}

