import { calculateP25 } from "./percentile.js";

export interface VmafParsedResult {
  framesScored: number;
  mean: number;
  p25: number;
  hmean?: number;
  min?: number;
  max?: number;
}

export function parseVmafJson(jsonString: string): VmafParsedResult {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: any) {
    throw new Error(`Failed to parse VMAF JSON output: ${err.message}`);
  }

  // Extract per-frame vmaf scores
  const framesList: any[] = parsed.frames ?? [];
  const perFrameScores: number[] = [];

  for (const frame of framesList) {
    const vmafVal = frame.metrics?.vmaf;
    if (typeof vmafVal === "number" && !isNaN(vmafVal)) {
      perFrameScores.push(vmafVal);
    }
  }

  const framesScored = perFrameScores.length;
  if (framesScored === 0) {
    throw new Error("VMAF JSON output contains zero scored frames");
  }

  // Calculate p25 from sorted per-frame linear interpolation (Errata E5)
  const p25 = calculateP25(perFrameScores);

  // Extract pooled metrics if present (can be in pooled_metrics.vmaf or metrics.vmaf)
  const pooled = parsed.pooled_metrics?.vmaf ?? parsed.metrics?.vmaf ?? {};

  let mean = pooled.mean;
  if (typeof mean !== "number" || isNaN(mean)) {
    // Fallback: compute arithmetic mean
    const sum = perFrameScores.reduce((acc, v) => acc + v, 0);
    mean = sum / framesScored;
  }

  let min = pooled.min;
  if (typeof min !== "number" || isNaN(min)) {
    min = Math.min(...perFrameScores);
  }

  let max = pooled.max;
  if (typeof max !== "number" || isNaN(max)) {
    max = Math.max(...perFrameScores);
  }

  let hmean = pooled.harmonic_mean;
  if (typeof hmean !== "number" || isNaN(hmean)) {
    // Harmonic mean = N / sum(1/x) for positive numbers
    const validScores = perFrameScores.filter((x) => x > 0);
    if (validScores.length > 0) {
      const invSum = validScores.reduce((acc, v) => acc + 1 / v, 0);
      hmean = validScores.length / invSum;
    }
  }

  return {
    framesScored,
    mean: Number(mean.toFixed(4)),
    p25: Number(p25.toFixed(4)),
    hmean: typeof hmean === "number" ? Number(hmean.toFixed(4)) : undefined,
    min: typeof min === "number" ? Number(min.toFixed(4)) : undefined,
    max: typeof max === "number" ? Number(max.toFixed(4)) : undefined,
  };
}

