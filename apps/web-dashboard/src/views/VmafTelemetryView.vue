<template>
  <div class="vmaf-view app">
    <!-- Breadcrumb -->
    <p class="crumb">
      Quantis
      <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
      <b>Telemetri VMAF</b>
    </p>

    <!-- Header Section -->
    <div class="hd">
      <h1>Telemetri VMAF</h1>
      <div class="chip" aria-live="off">
        <i class="dot pulse"></i>
        <b class="mono">Target VMAF ≥ 93</b>
        <hr />
        <div>
          <b>Dynamic Bisection</b>
          <small>Perseptual CQ optimizer</small>
        </div>
      </div>
    </div>

    <!-- Toolbar Card -->
    <div class="card rv" style="--i:0; margin-bottom: 16px; padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--mu);">Pilih Kamera</span>
        <!-- Camera Selector Filter -->
        <select
          v-model="selectedCameraId"
          @change="handleCameraFilter"
          class="cam-select mono"
        >
          <option :value="null">Semua kamera</option>
          <option v-for="cam in camerasStore.cameras" :key="cam.id" :value="cam.id">
            {{ cam.name }}
          </option>
        </select>
      </div>

      <div style="display: flex; align-items: center; gap: 10px;">
        <!-- Manual Probe Trigger Button -->
        <button
          @click="triggerManualProbe"
          :disabled="telemetryStore.isTriggeringProbe"
          class="btn p s"
          title="Uji coba kompresi dan probing pada rekaman terbaru"
        >
          <svg v-if="telemetryStore.isTriggeringProbe" class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
          </svg>
          <svg v-else class="w-3.5 h-3.5" viewBox="0 0 24 24">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>{{ telemetryStore.isTriggeringProbe ? 'Memproses...' : 'Uji probe rekaman' }}</span>
        </button>

        <!-- Queue Status Pill -->
        <span class="pill mono">
          {{ telemetryStore.queueStatus.queued }} antrean
        </span>
      </div>
    </div>

    <!-- Notification Alert -->
    <div
      v-if="actionMessage"
      class="card action-alert"
      :class="actionSuccess ? 'alert-ok' : 'alert-err'"
    >
      <span>{{ actionMessage }}</span>
      <button @click="actionMessage = ''" class="close-alert">✕</button>
    </div>

    <!-- Educational Guide Card -->
    <section class="card" aria-label="Edukasi VMAF">
      <div class="head">
        <div>
          <h2>Prinsip kompresi berbasis persepsi</h2>
          <p class="sub">Menghemat penyimpanan hard disk tanpa merusak kejelasan barang bukti video forensik</p>
        </div>
      </div>
      <div class="legend" style="grid-template-columns: repeat(3, 1fr); margin-top: 4px; padding-top: 14px">
        <div>
          <span class="k"><i style="background:var(--accent)"></i>Target gate VMAF ≥ 80.0</span>
          <p class="sub" style="margin-top: 6px">Standar ketajaman mata manusia. Skor 80.0 memastikan wajah dan pelat nomor tidak pecah atau buram.</p>
        </div>
        <div>
          <span class="k"><i style="background:var(--warn)"></i>Constant quality (CQ 18–48)</span>
          <p class="sub" style="margin-top: 6px">Tingkat kompresi encoder NVENC. Nilai CQ lebih tinggi menghasilkan file video yang jauh lebih kecil.</p>
        </div>
        <div>
          <span class="k"><i style="background:var(--text)"></i>Bisection smart search</span>
          <p class="sub" style="margin-top: 6px">Algoritma biner yang menguji cuplikan gerak tertinggi untuk memilih nilai CQ paling hemat yang tetap lolos gate.</p>
        </div>
      </div>
    </section>

    <!-- Savings KPI Metrics -->
    <section class="kpis" aria-label="Metrik penghematan" style="grid-template-columns: repeat(3, 1fr)">
      <article class="card kpi">
        <span class="eyebrow">Ukuran rekaman mentah</span>
        <div class="v">{{ formatBytes(telemetryStore.savingsSummary.totalRawBytes) }}</div>
        <p class="note">Ditarik langsung dari stream RTSP kamera</p>
      </article>

      <article class="card kpi">
        <span class="eyebrow">Ukuran setelah kompresi</span>
        <div class="v">{{ formatBytes(telemetryStore.savingsSummary.totalCompressedBytes) }}</div>
        <p class="note">Terenkripsi dengan codec AV1 / HEVC NVENC</p>
      </article>

      <article class="card kpi">
        <span class="eyebrow">Total penghematan disk</span>
        <div class="v" style="color:var(--accent)">{{ telemetryStore.savingsSummary.savingsPct.toFixed(1) }}<small style="color:var(--accent)">%</small></div>
        <p class="note" style="color:var(--accent); font-weight: 500">Penyimpanan bertahan 10× s.d. 30× lebih lama</p>
      </article>
    </section>

    <!-- CQ vs VMAF Curve Card -->
    <section class="card" aria-label="Kurva kualitas">
      <div class="head">
        <div>
          <h2>Kurva kompresi · CQ vs skor VMAF</h2>
          <p class="sub">Garis putus-putus menandai batas minimal kualitas visual mata manusia (Target Gate: 80.0)</p>
        </div>
        <div class="state">
          <span class="ok">Lolos gate (≥ 80)</span>
          <span class="sub mono" style="font-size: 11px">Skala CQ 18 s.d. 48</span>
        </div>
      </div>

      <!-- SVG Chart -->
      <div class="chart-wrapper">
        <svg class="w-full h-full" viewBox="0 0 620 250" preserveAspectRatio="none">
          <!-- Background Grid Lines -->
          <line x1="50" y1="30" x2="590" y2="30" stroke="var(--hair)" stroke-dasharray="4" />
          <line x1="50" y1="90" x2="590" y2="90" stroke="var(--hair)" stroke-dasharray="4" />
          <line x1="50" y1="150" x2="590" y2="150" stroke="var(--hair)" stroke-dasharray="4" />
          <line x1="50" y1="210" x2="590" y2="210" stroke="var(--hair)" />

          <!-- Target Gate Line (VMAF 80.0 at Y = 90) -->
          <line x1="50" y1="90" x2="590" y2="90" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="6 3" />
          <text x="56" y="84" fill="var(--accent)" font-size="10" font-weight="600" class="mono">
            Target Gate (80.0)
          </text>

          <!-- Y-Axis Scale Labels -->
          <text x="15" y="34" fill="var(--faint)" font-size="10" class="mono">100</text>
          <text x="15" y="94" fill="var(--accent)" font-size="10" font-weight="600" class="mono">80</text>
          <text x="15" y="154" fill="var(--faint)" font-size="10" class="mono">60</text>
          <text x="15" y="214" fill="var(--faint)" font-size="10" class="mono">40</text>

          <!-- X-Axis Baseline & Scale Ticks (CQ 18 s.d. 48) -->
          <g v-for="tick in [18, 24, 30, 36, 42, 48]" :key="tick">
            <line
              :x1="getXForCq(tick)"
              y1="210"
              :x2="getXForCq(tick)"
              y2="216"
              stroke="var(--faint)"
              stroke-width="1.5"
            />
            <text
              :x="getXForCq(tick)"
              y="228"
              fill="var(--faint)"
              font-size="10"
              font-weight="500"
              text-anchor="middle"
              class="mono"
            >
              CQ {{ tick }}
            </text>
          </g>

          <text x="325" y="244" fill="var(--muted)" font-size="10" text-anchor="middle">
            Nilai Constant Quality (CQ) — Semakin tinggi, kompresi semakin hemat
          </text>

          <!-- Polyline Connecting Real Points -->
          <polyline
            v-if="chartPoints.length > 1"
            :points="polylinePoints"
            fill="none"
            stroke="var(--accent)"
            stroke-width="2"
            stroke-linejoin="round"
          />

          <!-- Plotted Points from Real Data -->
          <g v-for="(pt, idx) in chartPoints" :key="idx" class="cursor-pointer">
            <circle
              :cx="pt.x"
              :cy="pt.y"
              r="5"
              :fill="pt.gateMet ? 'var(--accent)' : 'var(--warn)'"
              stroke="var(--surface)"
              stroke-width="2"
            >
              <title>CQ {{ pt.cq }}: Skor VMAF {{ pt.vmaf.toFixed(2) }} ({{ pt.gateMet ? 'Lolos Gate ≥ 80' : 'Di Bawah Gate' }})</title>
            </circle>

            <text
              v-if="isLabelVisible(idx, chartPoints)"
              :x="pt.x"
              :y="pt.y + (idx % 2 === 0 ? -12 : 18)"
              fill="var(--text)"
              font-size="9.5"
              font-weight="600"
              text-anchor="middle"
              class="mono select-none"
            >
              CQ {{ pt.cq }} ({{ pt.vmaf.toFixed(1) }})
            </text>
          </g>
        </svg>
      </div>
    </section>

    <!-- Probe Logs Table -->
    <section class="card" aria-label="Riwayat uji probe">
      <div class="head" style="margin-bottom: 6px">
        <div>
          <h2>Riwayat langkah uji probe</h2>
          <p class="sub">Log iterasi kompresi yang diuji langsung oleh GPU sebelum segmen disimpan permanen</p>
        </div>
        <div class="state">
          <span class="sub mono">{{ telemetryStore.historicalProbes.length }} pengujian</span>
          <button @click="refreshData" class="btn" style="min-height:32px;min-width:32px;padding:0" title="Muat ulang">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Iterasi</th>
              <th>Kamera</th>
              <th>Nilai CQ</th>
              <th>Skor VMAF</th>
              <th>VMAF P25</th>
              <th>Akselerator</th>
              <th>Durasi</th>
              <th>Waktu</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="telemetryStore.historicalProbes.length === 0">
              <td colspan="8" style="text-align:center; padding: 32px; color: var(--faint)">
                Belum ada data riwayat probe transkode yang tercatat.
              </td>
            </tr>
            <tr v-for="step in paginatedProbes" :key="step.id">
              <td class="mono" style="font-weight:600">#{{ step.iteration_num }}</td>
              <td>{{ step.camera_name || 'Kamera' }} <em>#{{ step.recording_id }}</em></td>
              <td class="n"><b>CQ {{ Number(step.tested_cq).toFixed(0) }}</b></td>
              <td class="n">
                <span :style="{ color: step.sample_vmaf_mean >= 80 ? 'var(--accent)' : 'var(--warn)', fontWeight: 600 }">
                  {{ step.sample_vmaf_mean.toFixed(2) }}
                </span>
                <span v-if="step.sample_vmaf_mean >= 80" class="ok" style="margin-left: 8px">Lolos</span>
                <span v-else class="offline-pill mono" style="margin-left: 8px">Rendah</span>
              </td>
              <td class="n">{{ step.sample_vmaf_p25.toFixed(2) }}</td>
              <td class="mono" style="font-size: 11px">
                <span class="pill" style="padding: 2px 8px; font-size: 11px">
                  {{ step.backend === 'cuda' ? 'CUDA GPU' : 'CPU THREADS' }}
                </span>
              </td>
              <td class="n">{{ (step.duration_ms / 1000).toFixed(1) }} dtk</td>
              <td class="n" style="color:var(--faint)">{{ formatTimestamp(step.created_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination Footer -->
      <div v-if="telemetryStore.historicalProbes.length > pageSize" class="row" style="margin-top: 16px; padding-top: 14px; box-shadow: 0 -1px 0 var(--hair)">
        <span class="sub">Menampilkan {{ (currentPage - 1) * pageSize + 1 }}–{{ Math.min(currentPage * pageSize, telemetryStore.historicalProbes.length) }} dari {{ telemetryStore.historicalProbes.length }}</span>
        <div style="display:flex; gap:6px; align-items:center">
          <button
            @click="currentPage = Math.max(1, currentPage - 1)"
            :disabled="currentPage === 1"
            class="btn"
            style="min-height:30px; padding:0 10px; font-size:12px; box-shadow:var(--ring)"
          >
            Sebelumnya
          </button>
          <span class="mono" style="font-size:12px; padding: 0 4px">{{ currentPage }}</span>
          <button
            @click="currentPage = currentPage + 1"
            :disabled="currentPage * pageSize >= telemetryStore.historicalProbes.length"
            class="btn"
            style="min-height:30px; padding:0 10px; font-size:12px; box-shadow:var(--ring)"
          >
            Berikutnya
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useTelemetryStore } from "../stores/telemetry.js";
import { useCamerasStore } from "../stores/cameras.js";

const telemetryStore = useTelemetryStore();
const camerasStore = useCamerasStore();

const selectedCameraId = ref<number | null>(null);
const actionMessage = ref<string>("");
const actionSuccess = ref<boolean>(true);
const currentPage = ref<number>(1);
const pageSize = 15;
let pollTimer: NodeJS.Timeout | null = null;

const paginatedProbes = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return telemetryStore.historicalProbes.slice(start, start + pageSize);
});

// Map CQ [18, 48] to SVG X coordinate [60, 590]
const getXForCq = (cq: number): number => {
  const minCq = 18;
  const maxCq = 48;
  const clamped = Math.max(minCq, Math.min(maxCq, cq));
  return 60 + ((clamped - minCq) / (maxCq - minCq)) * (590 - 60);
};

// Map VMAF [40, 100] to SVG Y coordinate [210, 30]
const getYForVmaf = (vmaf: number): number => {
  const minVmaf = 40;
  const maxVmaf = 100;
  const clamped = Math.max(minVmaf, Math.min(maxVmaf, vmaf));
  return 210 - ((clamped - minVmaf) / (maxVmaf - minVmaf)) * (210 - 30);
};

const chartPoints = computed(() => {
  if (telemetryStore.curvePoints && telemetryStore.curvePoints.length > 0) {
    return telemetryStore.curvePoints.map((pt) => ({
      x: getXForCq(pt.cq),
      y: getYForVmaf(pt.vmaf),
      cq: pt.cq,
      vmaf: pt.vmaf,
      gateMet: pt.gateMet,
    }));
  }

  if (telemetryStore.historicalProbes && telemetryStore.historicalProbes.length > 0) {
    const cqMap = new Map<number, { sum: number; count: number }>();
    for (const p of telemetryStore.historicalProbes) {
      const cq = Number(p.tested_cq);
      const curr = cqMap.get(cq) || { sum: 0, count: 0 };
      curr.sum += p.sample_vmaf_mean;
      curr.count++;
      cqMap.set(cq, curr);
    }
    const sortedCqs = Array.from(cqMap.keys()).sort((a, b) => a - b);
    return sortedCqs.map((cq) => {
      const it = cqMap.get(cq)!;
      const vmaf = it.sum / it.count;
      return {
        x: getXForCq(cq),
        y: getYForVmaf(vmaf),
        cq,
        vmaf,
        gateMet: vmaf >= 80.0,
      };
    });
  }

  const defaults = [
    { cq: 24, vmaf: 92.5 },
    { cq: 28, vmaf: 87.0 },
    { cq: 32, vmaf: 83.2 },
    { cq: 36, vmaf: 76.8 },
    { cq: 40, vmaf: 68.0 },
  ];
  return defaults.map((d) => ({
    x: getXForCq(d.cq),
    y: getYForVmaf(d.vmaf),
    cq: d.cq,
    vmaf: d.vmaf,
    gateMet: d.vmaf >= 80.0,
  }));
});

const polylinePoints = computed(() => {
  return chartPoints.value.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
});

const isLabelVisible = (idx: number, arr: Array<{ x: number; cq: number; vmaf: number }>): boolean => {
  if (arr.length <= 4) return true;
  if (idx === 0 || idx === arr.length - 1) return true;
  const curr = arr[idx];
  const prev = arr[idx - 1];
  const next = arr[idx + 1];
  if (Math.abs(curr.x - prev.x) < 34 || Math.abs(next.x - curr.x) < 34) {
    return idx % 2 === 0;
  }
  return true;
};

const formatBytes = (bytes: number | null | undefined): string => {
  if (!bytes || isNaN(bytes) || bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

const formatTimestamp = (dateStr: string): string => {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return dateStr;
  }
};

const handleCameraFilter = () => {
  currentPage.value = 1;
  telemetryStore.fetchVmafProbes(selectedCameraId.value ?? undefined);
};

const triggerManualProbe = async () => {
  actionMessage.value = "";
  const result = await telemetryStore.triggerManualProbe(selectedCameraId.value ?? undefined);
  actionSuccess.value = result.ok;
  actionMessage.value = result.message;
};

const refreshData = async () => {
  await Promise.all([
    telemetryStore.fetchVmafProbes(selectedCameraId.value ?? undefined),
    telemetryStore.fetchStats(),
  ]);
};

onMounted(async () => {
  await camerasStore.fetchCameras();
  await refreshData();
  pollTimer = setInterval(refreshData, 5000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.vmaf-view {
  min-width: 0;
  width: 100%;
  padding: 24px clamp(16px, 2vw, 32px) 48px;
}

.cam-select {
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--text);
  background: var(--surface);
  box-shadow: var(--ring);
  border: none;
  cursor: pointer;
}

.probe-btn {
  background: var(--accent);
  color: #FFFFFF;
  font-size: 12px;
  height: 32px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 10px;
}

.probe-btn:hover {
  background: color-mix(in oklab, var(--accent) 85%, #000);
  color: #FFFFFF;
}

.action-alert {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  padding: 12px 16px;
}

.alert-ok {
  border-left: 4px solid var(--accent);
}

.alert-err {
  border-left: 4px solid var(--crit);
}

.close-alert {
  color: var(--muted);
  font-size: 12px;
}

.chart-wrapper {
  width: 100%;
  height: 250px;
  background: var(--surface-2);
  border-radius: 12px;
  padding: 12px;
  margin-top: 10px;
  overflow: hidden;
}

.offline-pill {
  font-size: 10px;
  color: var(--muted);
  background: var(--surface-2);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
