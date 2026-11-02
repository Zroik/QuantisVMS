import { defineStore } from "pinia";
import { ref } from "vue";
import { apiFetch } from "../services/api.js";

export interface SystemConfig {
  general: {
    instanceName: string;
    location: string;
    timezone: string;
    ntpServer: string;
    language: string;
    theme: string;
  };
  camera_streaming: {
    defaultTransport: string;
    stunServer: string;
    internalRtspPort: number;
    whepPort: number;
    hlsPort: number;
  };
  ai_engine: {
    model: string;
    engineVersion: string;
    inferenceFps: number;
    confidenceThreshold: number;
    weights: {
      person: number;
      vehicle: number;
      pet: number;
      other: number;
    };
  };
  recording: {
    segmentDurationMin: number;
    durationPreset: string;
    clockAligned: boolean;
    autoConsolidateHourly: boolean;
    snapshotFormat: string;
    snapshotQuality: number;
    snapshotOverlay?: boolean;
  };
  compression: {
    preferredEncoder: string;
    encoderPreset: string;
    targetVmafMean: number;
    targetVmafP25: number;
    vmafBackend: string;
    compressionDelayHours: number;
    pixelFormat?: string;
  };
  storage: {
    rawDir: string;
    compressedDir: string;
    snapshotsDir: string;
    tmpDir: string;
    highWatermarkPct: number;
    criticalWatermarkPct: number;
    retentionGraceHours: number;
  };
  network: {
    httpPort: number;
    apiPort: number;
    rtspPort: number;
    whepPort: number;
    hlsPort: number;
    rtspConnectTimeoutMs: number;
    rtspReadTimeoutMs: number;
    allowedCors: string[];
  };
  performance: {
    transcodeWorkers: number;
    gpuVramCapMb: number;
    schedulerTickSec: number;
  };
  security: {
    jwtAccessExpiryMin: number;
    jwtRefreshExpiryDays: number;
    encryptionAlgo: string;
    auditTrailEnabled: boolean;
  };
}

export const useConfigStore = defineStore("config", () => {
  const config = ref<SystemConfig>({
    general: {
      instanceName: "Quantis Forensic Node 01",
      location: "Main Facility - Server Rack A",
      timezone: "Asia/Jakarta",
      ntpServer: "id.pool.ntp.org",
      language: "id",
      theme: "dark",
    },
    camera_streaming: {
      defaultTransport: "tcp",
      stunServer: "stun:stun.l.google.com:19302",
      internalRtspPort: 8554,
      whepPort: 8555,
      hlsPort: 8888,
    },
    ai_engine: {
      model: "YOLO26n",
      engineVersion: "YOLO26n TensorRT 10.x (CUDA FP16 NMS-Free)",
      inferenceFps: 10,
      confidenceThreshold: 0.35,
      weights: {
        person: 3,
        vehicle: 2,
        pet: 1,
        other: 1,
      },
    },
    recording: {
      segmentDurationMin: 60,
      durationPreset: "60",
      clockAligned: true,
      autoConsolidateHourly: true,
      snapshotFormat: "jpeg",
      snapshotQuality: 90,
      snapshotOverlay: false,
    },
    compression: {
      preferredEncoder: "hevc_nvenc",
      encoderPreset: "p5",
      targetVmafMean: 85.0,
      targetVmafP25: 81.0,
      vmafBackend: "cuda",
      compressionDelayHours: 24,
      pixelFormat: "10-bit P010",
    },
    storage: {
      rawDir: "/data/raw",
      compressedDir: "/data/compressed",
      snapshotsDir: "/data/snapshots",
      tmpDir: "/data/tmp",
      highWatermarkPct: 85,
      criticalWatermarkPct: 95,
      retentionGraceHours: 24,
    },
    network: {
      httpPort: 5173,
      apiPort: 3000,
      rtspPort: 8554,
      whepPort: 8555,
      hlsPort: 8888,
      rtspConnectTimeoutMs: 5000,
      rtspReadTimeoutMs: 10000,
      allowedCors: ["http://localhost:5173", "http://127.0.0.1:5173"],
    },
    performance: {
      transcodeWorkers: 1,
      gpuVramCapMb: 6144,
      schedulerTickSec: 5,
    },
    security: {
      jwtAccessExpiryMin: 15,
      jwtRefreshExpiryDays: 7,
      encryptionAlgo: "AES-256-GCM",
      auditTrailEnabled: true,
    },
  });

  const isLoading = ref<boolean>(false);
  const isSaving = ref<boolean>(false);
  const error = ref<string | null>(null);
  const saveSuccess = ref<boolean>(false);

  const fetchConfig = async () => {
    isLoading.value = true;
    error.value = null;
    try {
      const res = await apiFetch("/api/config");
      if (!res.ok) throw new Error("Gagal mengambil konfigurasi sistem");
      const data = await res.json();
      if (data.config) {
        config.value = { ...config.value, ...data.config };
      }
    } catch (err: any) {
      error.value = err.message;
    } finally {
      isLoading.value = false;
    }
  };

  const saveConfig = async (partialUpdates?: Partial<SystemConfig>): Promise<boolean> => {
    isSaving.value = true;
    error.value = null;
    saveSuccess.value = false;
    try {
      const payload = partialUpdates || config.value;
      const res = await apiFetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Gagal menyimpan konfigurasi");
      }
      const data = await res.json();
      if (data.config) {
        config.value = { ...config.value, ...data.config };
      }
      saveSuccess.value = true;
      setTimeout(() => {
        saveSuccess.value = false;
      }, 4000);
      return true;
    } catch (err: any) {
      error.value = err.message;
      return false;
    } finally {
      isSaving.value = false;
    }
  };

  return {
    config,
    isLoading,
    isSaving,
    error,
    saveSuccess,
    fetchConfig,
    saveConfig,
  };
});

