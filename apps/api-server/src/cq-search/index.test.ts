import { describe, it, expect, vi } from "vitest";
import { searchCq, type VmafScore, type GatePredicate } from "./index.js";

describe("searchCq Bisection Algorithm (Spec §8.4 & Gate G1.7)", () => {
  const defaultGate: GatePredicate = (s) => s.mean >= 85.0 && s.p25 >= 81.0;

  it("converges to optimal CQ on standard monotone curve in <= 5 probes for 31 values", async () => {
    // Monotone curve: VMAF decreases as CQ increases
    // CQ 18: mean 96.0, p25 93.0
    // CQ 30: mean 87.0, p25 83.0 -> PASS
    // CQ 31: mean 86.0, p25 81.5 -> PASS
    // CQ 32: mean 85.0, p25 80.5 -> FAIL (p25 < 81.0)
    // Optimal passing CQ should be 31
    const probeCallLog: number[] = [];
    const fakeProbe = vi.fn((cq: number): VmafScore => {
      probeCallLog.push(cq);
      const mean = 96.0 - (cq - 18) * 0.8;
      const p25 = 93.0 - (cq - 18) * 0.9;
      return { mean, p25, backend: "cuda", frames: 500 };
    });

    const result = await searchCq(fakeProbe, defaultGate, { cqMin: 18, cqMax: 48 });

    expect(result.gateMet).toBe(true);
    expect(result.cq).toBe(31);
    expect(result.probesCount).toBeLessThanOrEqual(5);
    expect(fakeProbe).toHaveBeenCalled();
  });

  it("handles all-pass curve: returns max CQ (48) with gateMet: true in <= 5 probes", async () => {
    const fakeProbe = vi.fn((cq: number): VmafScore => ({
      mean: 95.0,
      p25: 92.0,
      backend: "cuda",
      frames: 500,
    }));

    const result = await searchCq(fakeProbe, defaultGate, { cqMin: 18, cqMax: 48 });

    expect(result.gateMet).toBe(true);
    expect(result.cq).toBe(48);
    expect(result.probesCount).toBeLessThanOrEqual(5);
  });

  it("handles none-pass curve: falls back to cqMin (18) with gateMet: false", async () => {
    const fakeProbe = vi.fn((cq: number): VmafScore => ({
      mean: 70.0,
      p25: 65.0,
      backend: "cuda",
      frames: 500,
    }));

    const result = await searchCq(fakeProbe, defaultGate, { cqMin: 18, cqMax: 48 });

    expect(result.gateMet).toBe(false);
    expect(result.cq).toBe(18);
    // At most 5 probes of bisection + probe of cqMin (which was already probed during bisection or at end)
    expect(result.probesCount).toBeLessThanOrEqual(6);
  });

  it("handles single-value range (cqMin == cqMax) with exactly 1 probe", async () => {
    const fakeProbe = vi.fn((cq: number): VmafScore => ({
      mean: 88.0,
      p25: 84.0,
      backend: "cuda",
      frames: 500,
    }));

    const result = await searchCq(fakeProbe, defaultGate, { cqMin: 28, cqMax: 28 });

    expect(result.gateMet).toBe(true);
    expect(result.cq).toBe(28);
    expect(result.probesCount).toBe(1);
    expect(fakeProbe).toHaveBeenCalledTimes(1);
  });

  it("properly memoizes probe results and does not call probe twice for the same CQ", async () => {
    const probeCountMap = new Map<number, number>();
    const fakeProbe = vi.fn((cq: number): VmafScore => {
      probeCountMap.set(cq, (probeCountMap.get(cq) ?? 0) + 1);
      return { mean: 90.0, p25: 85.0, backend: "cuda", frames: 500 };
    });

    const result = await searchCq(fakeProbe, defaultGate, {
      cqMin: 18,
      cqMax: 48,
      initialHint: 33, // Initial hint touches 33
    });

    // Check no CQ was queried more than once
    for (const [cq, count] of probeCountMap.entries()) {
      expect(count).toBe(1);
    }
    expect(result.probesCount).toBeLessThanOrEqual(6);
  });

  it("handles noisy curve gracefully within bounds", async () => {
    // Curve with noise around threshold
    const fakeProbe = vi.fn((cq: number): VmafScore => {
      const base = 95 - (cq - 18) * 0.9;
      const noise = (cq % 2 === 0) ? 0.3 : -0.3;
      return { mean: base + noise, p25: base - 3 + noise, backend: "cuda", frames: 500 };
    });

    const result = await searchCq(fakeProbe, defaultGate, { cqMin: 18, cqMax: 48 });

    expect(result.cq).toBeGreaterThanOrEqual(18);
    expect(result.cq).toBeLessThanOrEqual(48);
    expect(result.probesCount).toBeLessThanOrEqual(5);
  });

  it("handles non-monotone curve without infinite loop", async () => {
    const fakeProbe = vi.fn((cq: number): VmafScore => {
      // Non-monotone synthetic values
      const scores: Record<number, { mean: number; p25: number }> = {
        18: { mean: 95, p25: 90 },
        33: { mean: 80, p25: 75 }, // fails
        25: { mean: 86, p25: 82 }, // passes
        29: { mean: 84, p25: 80 }, // fails
        27: { mean: 87, p25: 83 }, // passes
        28: { mean: 83, p25: 79 }, // fails
      };
      const score = scores[cq] ?? { mean: 70, p25: 60 };
      return { ...score, backend: "cuda", frames: 500 };
    });

    const result = await searchCq(fakeProbe, defaultGate, { cqMin: 18, cqMax: 48 });

    expect(result.cq).toBeGreaterThanOrEqual(18);
    expect(result.cq).toBeLessThanOrEqual(48);
    expect(result.probesCount).toBeLessThanOrEqual(5);
  });

  it("respects safetyMargin and clamps to cqMin", async () => {
    const fakeProbe = vi.fn((cq: number): VmafScore => ({
      mean: 90.0,
      p25: 85.0,
      backend: "cuda",
      frames: 500,
    }));

    // With safetyMargin 2, if best is 48 -> returns 46
    const res1 = await searchCq(fakeProbe, defaultGate, { cqMin: 18, cqMax: 48, safetyMargin: 2 });
    expect(res1.cq).toBe(46);

    // If best is 19 with safetyMargin 3 -> clamped to cqMin (18)
    const fakeProbeLow = vi.fn((cq: number): VmafScore => {
      const mean = (cq <= 19) ? 90 : 70;
      return { mean, p25: mean - 3, backend: "cuda", frames: 500 };
    });
    const res2 = await searchCq(fakeProbeLow, defaultGate, { cqMin: 18, cqMax: 48, safetyMargin: 3 });
    expect(res2.cq).toBe(18);
  });
});

