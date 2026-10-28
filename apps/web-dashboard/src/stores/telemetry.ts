import { defineStore } from "pinia";
import { ref } from "vue";
import { useAuthStore } from "./auth.js";

export interface ProbeStep {
  recording_id: number;
  chunk_index: number;
  iteration: number;
  cq: number;
  vmaf_mean: number;
  vmaf_p25: number;
  backend: string;
  duration_ms: number;
  received_at?: number;
}

export interface HardwareStats {
  gpuUtil: number;
  vramUsedMb: number;
  vramTotalMb: number;
  gpuTemp: number;
  nvencActive: boolean;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskPercent: number;
  cpuPercent: number;
  ramPercent: number;
}

export const useTelemetryStore = defineStore("telemetry", () => {
  const authStore = useAuthStore();
  const probeSteps = ref<ProbeStep[]>([]);
  const queueStatus = ref<{
    queued: number;
    probing: number;
    encoding: number;
    verifying: number;
  }>({
    queued: 0,
    probing: 0,
    encoding: 0,
    verifying: 0,
  });

  const savingsSummary = ref<{
    totalRawBytes: number;
    totalCompressedBytes: number;
    savingsPct: number;
  }>({
    totalRawBytes: 0,
    totalCompressedBytes: 0,
    savingsPct: 0,
  });

  const hwStats = ref<HardwareStats>({
    gpuUtil: 0,
    vramUsedMb: 0,
    vramTotalMb: 8192,
    gpuTemp: 45,
    nvencActive: false,
    diskUsedBytes: 0,
    diskTotalBytes: 1000000000000,
    diskPercent: 0,
    cpuPercent: 0,
    ramPercent: 0,
  });

  const addProbeStep = (step: ProbeStep) => {
    probeSteps.value.unshift({
      ...step,
      received_at: Date.now(),
    });
    // Keep last 100 probe steps
    if (probeSteps.value.length > 100) {
      probeSteps.value.pop();
    }
  };

  const fetchStats = async () => {
    if (!authStore.token) return;
    try {
      const res = await fetch("/api/stats", {
        headers: { Authorization: `Bearer ${authStore.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.queue) queueStatus.value = data.queue;
        if (data.savings) savingsSummary.value = data.savings;
        if (data.hardware) {
          hwStats.value = {
            ...hwStats.value,
            ...data.hardware,
          };
        }
      }
    } catch {
      // Ignore poll errors
    }
  };

  return {
    probeSteps,
    queueStatus,
    savingsSummary,
    hwStats,
    addProbeStep,
    fetchStats,
  };
});

