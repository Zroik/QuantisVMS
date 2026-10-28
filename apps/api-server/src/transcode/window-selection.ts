/**
 * Smart Probing — Window Selection Algorithm (Spec §8.3, Pure Function, Gate G4.1).
 */

export interface ActivityWindow {
  window_index: number;
  start_offset_sec: number;
  weighted_activity_score: number;
}

export interface StaticCqCacheInfo {
  cq: number;
  cachedAt: Date;
}

export interface WindowSelectionParams {
  chunkIndex: number;
  chunkStartSec: number;
  chunkDurationSec: number;
  sampleDurationSec: number;
  smartAiSampling: boolean;
  windows: ActivityWindow[];
  staticCqCache?: StaticCqCacheInfo | null;
  staticCqTtlSec?: number;
  now?: Date;
}

export interface WindowSelectionResult {
  chunkIndex: number;
  samplingMode: "ai_peak" | "static_cache" | "blind_mid" | "blind_fallback";
  sampleStartSec: number;
  coverage: number;
  cachedCq?: number;
  selectedWindow?: ActivityWindow;
}

/**
 * Pure function selecting the reference sample window for chunk k of recording R.
 */
export function selectProbeWindow(params: WindowSelectionParams): WindowSelectionResult {
  const {
    chunkIndex,
    chunkStartSec,
    chunkDurationSec,
    sampleDurationSec,
    smartAiSampling,
    windows,
    staticCqCache,
    staticCqTtlSec = 604800, // 7 days
    now = new Date(),
  } = params;

  // Midpoint start offset helper
  const middleSampleStart =
    chunkDurationSec <= sampleDurationSec
      ? chunkStartSec
      : chunkStartSec + (chunkDurationSec - sampleDurationSec) / 2;

  // 1. Filter windows in range [k*P, (k+1)*P - S]
  const maxAllowedStart = chunkStartSec + chunkDurationSec - sampleDurationSec;
  const chunkWindows = windows.filter(
    (w) => w.start_offset_sec >= chunkStartSec && w.start_offset_sec <= maxAllowedStart
  );

  // 2. Coverage calculation
  const expectedRows = Math.max(1, Math.floor(chunkDurationSec / sampleDurationSec));
  const coverage = Math.min(1.0, chunkWindows.length / expectedRows);

  // 3. If smart_ai_sampling is false -> blind_mid
  if (!smartAiSampling) {
    return {
      chunkIndex,
      samplingMode: "blind_mid",
      sampleStartSec: middleSampleStart,
      coverage,
    };
  }

  // 4. If coverage < 0.9 -> blind_fallback (sample at middle)
  if (coverage < 0.9) {
    return {
      chunkIndex,
      samplingMode: "blind_fallback",
      sampleStartSec: middleSampleStart,
      coverage,
    };
  }

  // Find max score among valid windows
  let maxScore = 0;
  let peakWindow: ActivityWindow | null = null;

  for (const win of chunkWindows) {
    if (win.weighted_activity_score > maxScore) {
      maxScore = win.weighted_activity_score;
      peakWindow = win;
    } else if (win.weighted_activity_score === maxScore && peakWindow !== null) {
      // Ties -> earliest window (Spec §8.3 item 5)
      if (win.start_offset_sec < peakWindow.start_offset_sec) {
        peakWindow = win;
      }
    }
  }

  // 5. If coverage >= 0.9 and max score > 0 -> ai_peak
  if (maxScore > 0 && peakWindow !== null) {
    return {
      chunkIndex,
      samplingMode: "ai_peak",
      sampleStartSec: peakWindow.start_offset_sec,
      coverage,
      selectedWindow: peakWindow,
    };
  }

  // 6. If coverage >= 0.9 and all scores == 0:
  // Check static_cq_cache freshness
  if (staticCqCache && staticCqCache.cq > 0 && staticCqCache.cachedAt) {
    const ageSec = (now.getTime() - new Date(staticCqCache.cachedAt).getTime()) / 1000;
    if (ageSec >= 0 && ageSec <= staticCqTtlSec) {
      return {
        chunkIndex,
        samplingMode: "static_cache",
        sampleStartSec: middleSampleStart,
        coverage,
        cachedCq: staticCqCache.cq,
      };
    }
  }

  // If cache is empty or expired, probe middle sample as blind_mid
  return {
    chunkIndex,
    samplingMode: "blind_mid",
    sampleStartSec: middleSampleStart,
    coverage,
  };
}

