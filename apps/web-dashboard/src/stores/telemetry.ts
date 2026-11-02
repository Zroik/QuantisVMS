import { defineStore } from "pinia";
import { ref } from "vue";
import { useAuthStore } from "./auth.js";
import { apiFetch } from "../services/api.js";

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

export interface HistoricalProbeLog {
  id: number;
  recording_id: number;
  camera_id: number;
  camera_name: string;
  iteration_num: number;
  tested_cq: number;
  sample_vmaf_mean: number;
  sample_vmaf_p25: number;
  backend: string;
  duration_ms: number;
  created_at: string;
}

export interface VmafCurvePoint {
  cq: number;
  vmaf: number;
  vmaf_p25: number;
  sample_count: number;
  gateMet: boolean;
}

export interface DiskBreakdown {
  rawBytes: number;
  compressedBytes: number;
  snapshotsBytes: number;
  otherBytes: number;
  freeBytes: number;
}

export interface StreamTelemetry {
  name: string;
  ready: boolean;
  codec: string;
  resolution: string;
  bitrateMbps: number;
  bitrateKbps: number;
  readersCount: number;
  inboundBytes: number;
}

export interface NetworkTelemetry {
  totalIngestMbps: number;
  totalReceivedBytes: number;
  streams: StreamTelemetry[];
}

export interface HardwareStats {
  cpuModel: string;
  cpuCores: number;
  cpuThreads?: number;
  cpuPercent: number;
  ramPercent: number;
  ramUsedBytes: number;
  ramTotalBytes: number;
  wslRamPercent?: number;
  wslRamUsedBytes?: number;
  wslRamTotalBytes?: number;
  gpuName: string;
  gpuUtil: number;
  vramUsedMb: number;
  vramTotalMb: number;
  gpuTemp: number;
  encUtil: number;
  decUtil: number;
  nvencActive: boolean;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  diskPercent: number;
  diskBreakdown: DiskBreakdown;
  network: NetworkTelemetry;
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
    cpuModel: "AMD Ryzen 7 7745HX",
    cpuCores: 8,
    cpuPercent: 0,
    ramPercent: 0,
    ramUsedBytes: 0,
    ramTotalBytes: 32 * 1024 * 1024 * 1024,
    wslRamPercent: 0,
    wslRamUsedBytes: 0,
    wslRamTotalBytes: 12 * 1024 * 1024 * 1024,
    gpuName: "NVIDIA GeForce RTX 4060 Laptop GPU",
    gpuUtil: 0,
    vramUsedMb: 0,
    vramTotalMb: 8188,
    gpuTemp: 45,
    encUtil: 0,
    decUtil: 0,
    nvencActive: false,
    diskUsedBytes: 0,
    diskTotalBytes: 512 * 1024 * 1024 * 1024,
    diskFreeBytes: 0,
    diskPercent: 0,
    diskBreakdown: {
      rawBytes: 0,
      compressedBytes: 0,
      snapshotsBytes: 0,
      otherBytes: 0,
      freeBytes: 0,
    },
    network: {
      totalIngestMbps: 0,
      totalReceivedBytes: 0,
      streams: [],
    },
  });

  // 60-second real-time historical ring buffers (30 samples @ 2s interval)
  const historyCpu = ref<number[]>([]);
  const historyGpu = ref<number[]>([]);
  const historyVram = ref<number[]>([]);
  const historyNet = ref<number[]>([]);

  const historicalProbes = ref<HistoricalProbeLog[]>([]);
  const curvePoints = ref<VmafCurvePoint[]>([]);
  const isTriggeringProbe = ref<boolean>(false);

  const addProbeStep = (step: ProbeStep) => {
    probeSteps.value.unshift({
      ...step,
      received_at: Date.now(),
    });
    if (probeSteps.value.length > 100) {
      probeSteps.value.pop();
    }

    // Also push to historicalProbes so table updates live
    historicalProbes.value.unshift({
      id: Date.now(),
      recording_id: step.recording_id,
      camera_id: 0,
      camera_name: `Rekaman #${step.recording_id}`,
      iteration_num: step.iteration,
      tested_cq: step.cq,
      sample_vmaf_mean: step.vmaf_mean,
      sample_vmaf_p25: step.vmaf_p25,
      backend: step.backend,
      duration_ms: step.duration_ms,
      created_at: new Date().toISOString(),
    });
    if (historicalProbes.value.length > 100) {
      historicalProbes.value.pop();
    }
  };

  const fetchVmafProbes = async (cameraId?: number) => {
    if (!authStore.token) return;
    try {
      const url = cameraId ? `/api/stats/vmaf-probes?cameraId=${cameraId}` : "/api/stats/vmaf-probes";
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.probes) historicalProbes.value = data.probes;
        if (data.curve) curvePoints.value = data.curve;
        if (data.queue) queueStatus.value = data.queue;
      }
    } catch (err) {
      console.error("[TelemetryStore] Error fetching VMAF probes:", err);
    }
  };

  const triggerManualProbe = async (cameraId?: number): Promise<{ ok: boolean; message: string }> => {
    if (!authStore.token) return { ok: false, message: "Belum terautentikasi" };
    isTriggeringProbe.value = true;
    try {
      const res = await apiFetch("/api/stats/trigger-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraId }),
      });
      const data = await res.json();
      if (res.ok) {
        // Refetch after 1 second
        setTimeout(() => {
          fetchVmafProbes(cameraId);
          fetchStats();
        }, 1000);
        return { ok: true, message: data.message || "Proses probe berhasil dipicu!" };
      } else {
        return { ok: false, message: data.error || "Gagal memicu probe." };
      }
    } catch (err: any) {
      return { ok: false, message: err.message || "Gagal menghubungi server." };
    } finally {
      isTriggeringProbe.value = false;
    }
  };

  const fetchStats = async () => {
    if (!authStore.token) return;
    try {
      const res = await apiFetch("/api/stats");
      if (res.ok) {
        const data = await res.json();
        if (data.queue) queueStatus.value = data.queue;
        if (data.savings) savingsSummary.value = data.savings;
        if (data.hardware) {
          hwStats.value = {
            ...hwStats.value,
            ...data.hardware,
          };

          // Append to history buffers with genuine telemetry
          const cpuVal = typeof data.hardware.cpuPercent === "number" && !isNaN(data.hardware.cpuPercent) ? data.hardware.cpuPercent : 0;
          const gpuVal = typeof data.hardware.gpuUtil === "number" && !isNaN(data.hardware.gpuUtil) ? data.hardware.gpuUtil : 0;
          const vramMb = typeof data.hardware.vramUsedMb === "number" && !isNaN(data.hardware.vramUsedMb) ? data.hardware.vramUsedMb : 0;
          const vramGb = Number((vramMb / 1024).toFixed(2));
          const netIn = typeof data.hardware.network?.totalIngestMbps === "number" && !isNaN(data.hardware.network.totalIngestMbps) ? data.hardware.network.totalIngestMbps : 0;

          if (historyCpu.value.length === 0) {
            historyCpu.value = Array(30).fill(Number(cpuVal.toFixed(1)));
            historyGpu.value = Array(30).fill(Number(gpuVal.toFixed(1)));
            historyVram.value = Array(30).fill(vramGb);
            historyNet.value = Array(30).fill(Number(netIn.toFixed(2)));
          } else {
            historyCpu.value.push(Number(cpuVal.toFixed(1)));
            if (historyCpu.value.length > 30) historyCpu.value.shift();

            historyGpu.value.push(Number(gpuVal.toFixed(1)));
            if (historyGpu.value.length > 30) historyGpu.value.shift();

            historyVram.value.push(vramGb);
            if (historyVram.value.length > 30) historyVram.value.shift();

            historyNet.value.push(Number(netIn.toFixed(2)));
            if (historyNet.value.length > 30) historyNet.value.shift();
          }
        }
      }
    } catch {
      // Ignore poll errors
    }
  };

  return {
    probeSteps,
    historicalProbes,
    curvePoints,
    isTriggeringProbe,
    queueStatus,
    savingsSummary,
    hwStats,
    historyCpu,
    historyGpu,
    historyVram,
    historyNet,
    addProbeStep,
    fetchVmafProbes,
    triggerManualProbe,
    fetchStats,
  };
});
