/**
 * Smart CQ Search Algorithm (Spec §8.4)
 * Pure TypeScript bisection search with memoization over CQ range [cqMin, cqMax].
 */

export interface VmafScore {
  mean: number;
  p25: number;
  hmean?: number;
  min?: number;
  backend: "cuda" | "cpu";
  frames: number;
}

export type GatePredicate = (score: VmafScore) => boolean;

export type ProbeFn = (cq: number) => Promise<VmafScore> | VmafScore;

export interface CqSearchOptions {
  cqMin?: number; // default 18
  cqMax?: number; // default 48
  safetyMargin?: number; // default 0
  initialHint?: number;
}

export interface CqSearchResult {
  cq: number;
  gateMet: boolean;
  score: VmafScore;
  probesCount: number;
  probedCqs: number[];
}

export async function searchCq(
  probe: ProbeFn,
  gate: GatePredicate,
  options: CqSearchOptions = {}
): Promise<CqSearchResult> {
  const cqMin = options.cqMin ?? 18;
  const cqMax = options.cqMax ?? 48;
  const safetyMargin = options.safetyMargin ?? 0;

  if (cqMin > cqMax) {
    throw new Error(`cqMin (${cqMin}) cannot be greater than cqMax (${cqMax})`);
  }

  const memo = new Map<number, VmafScore>();
  const probedOrder: number[] = [];

  const runProbe = async (cq: number): Promise<VmafScore> => {
    const existing = memo.get(cq);
    if (existing !== undefined) {
      return existing;
    }
    const result = await Promise.resolve(probe(cq));
    memo.set(cq, result);
    probedOrder.push(cq);
    return result;
  };

  // Optional: check initial hint if provided and within range
  if (options.initialHint !== undefined && options.initialHint >= cqMin && options.initialHint <= cqMax) {
    await runProbe(options.initialHint);
  }

  let lo = cqMin;
  let hi = cqMax;
  let best: { cq: number; score: VmafScore } | null = null;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const score = await runProbe(mid);

    if (gate(score)) {
      best = { cq: mid, score };
      lo = mid + 1; // Try higher CQ (lower bitrate / more compression)
    } else {
      hi = mid - 1; // Quality insufficient; search lower CQ (higher quality)
    }
  }

  if (best === null) {
    // None passed the gate; probe lowest CQ (highest quality) if not already probed
    const lowestScore = await runProbe(cqMin);
    return {
      cq: cqMin,
      gateMet: false,
      score: lowestScore,
      probesCount: memo.size,
      probedCqs: probedOrder,
    };
  }

  const selectedCq = Math.max(cqMin, best.cq - safetyMargin);
  const finalScore = (selectedCq === best.cq) ? best.score : await runProbe(selectedCq);

  return {
    cq: selectedCq,
    gateMet: true,
    score: finalScore,
    probesCount: memo.size,
    probedCqs: probedOrder,
  };
}
