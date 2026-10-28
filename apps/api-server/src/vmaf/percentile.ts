/**
 * Quantile calculation matching NumPy's default linear interpolation (method='linear').
 * Specifically used for p25 calculation from sorted per-frame VMAF metrics (Spec §2 E5).
 */

export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate percentile of empty array");
  }

  if (percentile < 0 || percentile > 100) {
    throw new Error(`Percentile must be between 0 and 100, got ${percentile}`);
  }

  if (values.length === 1) {
    return values[0];
  }

  // Sort ascending copy
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q = (percentile / 100) * (n - 1);
  const i = Math.floor(q);
  const fraction = q - i;

  if (i >= n - 1) {
    return sorted[n - 1];
  }

  return sorted[i] + fraction * (sorted[i + 1] - sorted[i]);
}

export function calculateP25(values: number[]): number {
  return calculatePercentile(values, 25);
}
