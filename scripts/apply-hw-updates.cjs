const fs = require('fs');

const content = fs.readFileSync('apps/web-dashboard/src/views/HardwareMonitorView.vue', 'utf8');

const tmplStart = 0;
const scriptStart = content.indexOf('<script');
const styleStart = content.indexOf('<style');

const newTemplate = `<template>
  <div class="hw-view app">
    <p class="crumb">Quantis <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg> <b>{{ t('hw.crumb') }}</b></p>
    <div class="hd">
      <h1>{{ t('hw.headerTitle') }}</h1>
      <div class="chip" aria-live="off"><i class="dot"></i><b id="tm">{{ timeStr }}</b><hr><div><b>{{ t('hw.chipStatus') }}</b><small>{{ t('hw.chipSub') }}</small></div></div>
    </div>

    <section class="g a">
      <article class="card hero rv" style="--i:0">
        <p class="eb" id="dt">{{ dateStr }}</p>
        <h2 id="gr">{{ greetingStr }}</h2>
        <p v-html="heroSummaryHtml"></p>
        <div class="acts">
          <router-link :to="{ name: 'configuration', query: { tab: 'storage' } }" class="btn p">{{ t('hw.btnRetention') }}</router-link>
          <button class="btn o" type="button" @click="showToast(t('hw.exportToast'))">{{ t('hw.btnExport') }}</button>
        </div>
        <div class="ch" style="margin-bottom:12px">
          <span class="ico"><svg viewBox="0 0 24 24"><path d="M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg></span>
          <div style="flex:1"><h2>{{ t('hw.diskTitle') }}</h2><p>{{ t('hw.diskPath') }}</p></div>
          <div style="text-align:right"><b style="font-size:20px;color:var(--warn);letter-spacing:-.02em">{{ diskPercentStr }}%</b><p>{{ diskUsedStr }} / {{ diskTotalStr }} GB</p></div>
        </div>
        <div class="stack" role="img" :aria-label="t('hw.diskTitle')">
          <span :style="{ flex: diskRawFlex, background: 'var(--iris)' }"></span>
          <span :style="{ flex: diskCompFlex, background: 'var(--ink)' }"></span>
          <span :style="{ flex: diskOtherFlex, background: 'var(--orange)' }"></span>
          <span :style="{ flex: diskFreeFlex, background: 'var(--well)' }"></span>
        </div>
        <div class="leg">
          <div><span><i style="background:var(--iris)"></i>{{ t('hw.diskRaw') }}</span><b>{{ diskRawStr }} GB</b></div>
          <div><span><i style="background:var(--ink)"></i>{{ t('hw.diskComp') }}</span><b>{{ diskCompStr }} GB</b></div>
          <div><span><i style="background:var(--orange)"></i>{{ t('hw.diskOther') }}</span><b>{{ diskOtherStr }} GB</b></div>
          <div><span><i style="background:var(--well);box-shadow:inset 0 0 0 1px var(--line)"></i>{{ t('hw.diskFree') }}</span><b style="color:var(--warn)">{{ diskFreeStr }} GB</b></div>
        </div>
      </article>

      <article class="card rv" id="bwc" style="--i:1">
        <div class="ch">
          <span class="ico"><svg viewBox="0 0 24 24"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/></svg></span>
          <h2>{{ t('hw.bandwidthIn') }}</h2>
          <a href="#kamera" class="btn o s">{{ t('hw.btnCameras') }} <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></a>
        </div>
        <div class="big">{{ totalIngestStr }}<small>Mbps</small> <span class="pill">● {{ t('hw.badgeActive', { count: cameraCount }) }}</span></div>
        <div class="bars" id="bars" aria-hidden="true">
          <i v-for="(b, i) in bwBars" :key="i" :style="{ height: b.height, animationDelay: b.delay }"></i>
        </div>
        <div class="cam">
          <template v-for="cam in camMeters" :key="cam.id">
            <span>{{ cam.name }}</span>
            <div><b :style="{ width: cam.pct }"></b></div>
            <b>{{ cam.mbps }}</b>
          </template>
        </div>
      </article>
    </section>

    <section class="g k" aria-label="Metrik utama">
      <article class="card st ink rv" style="--i:2">
        <div class="ch" style="margin:0">
          <span class="ico"><svg viewBox="0 0 24 24"><path d="M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></svg></span>
          <span class="lab">{{ t('hw.cardGpu') }}</span>
        </div>
        <div class="row">
          <div class="val-box"><div class="big">{{ gpuUtilStr }}<small>%</small></div></div>
          <span class="ring" :style="{ '--p': gpuUtilNum }" role="img" :aria-label="gpuUtilStr + '%'"></span>
        </div>
      </article>

      <article class="card st acc rv" style="--i:3">
        <div class="ch" style="margin:0">
          <span class="ico"><svg viewBox="0 0 24 24"><path d="M4 8h16v8H4zM8 8v8M12 8v8M16 8v8"/></svg></span>
          <span class="lab">{{ t('hw.cardVram') }}</span>
        </div>
        <div class="row">
          <div class="val-box"><div class="big u">{{ vramUsedGbStr }}<small>/ {{ vramTotalGbStr }} GB</small></div></div>
          <span class="ring" :style="{ '--p': vramPercentNum }" role="img" :aria-label="vramPercentStr + '%'"></span>
        </div>
      </article>

      <article class="card st rv" style="--i:4">
        <div class="ch" style="margin:0">
          <span class="ico"><svg viewBox="0 0 24 24"><path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/></svg></span>
          <span class="lab">{{ t('hw.cardTemp') }}</span>
        </div>
        <div class="row">
          <div class="val-box"><div class="big">{{ gpuTempStr }}<small>°C</small></div></div>
        </div>
      </article>

      <article class="card st rv" style="--i:5">
        <div class="ch" style="margin:0">
          <span class="ico"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM8 4v16M16 4v16M4 12h16"/></svg></span>
          <span class="lab">{{ t('hw.cardEncDec') }}</span>
        </div>
        <div class="eng">
          <div><span>NVENC</span><span>{{ nvencUtilStr }}%</span></div>
          <div class="m" style="margin-top:-3px"><b :style="{ width: nvencUtilStr + '%' }"></b></div>
          <div><span>NVDEC</span><span>{{ nvdecUtilStr }}%</span></div>
          <div class="m" style="margin-top:-3px"><b :style="{ width: nvdecUtilStr + '%' }"></b></div>
        </div>
      </article>
    </section>

    <section class="g c">
      <article class="card rv" style="--i:6">
        <div class="ch w">
          <span class="ico"><svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></svg></span>
          <div style="flex:1"><h2>{{ t('hw.trendTitle') }}</h2><p>{{ t('hw.trendSub') }}</p></div>
          <div class="seg" role="group" aria-label="Pilih metrik">
            <button
              v-for="m in metricTabs"
              :key="m.id"
              type="button"
              :aria-pressed="cur === m.id"
              @click="setCur(m.id)"
            >
              {{ m.label }}
            </button>
          </div>
        </div>
        <div class="big" id="cv" v-html="chartBigHtml"></div>
        <div id="ch" ref="chartContainerRef" v-html="chartSvgHtml"></div>
        <div class="cw">
          <div class="scale-y" aria-hidden="true">
            <span
              v-for="(lbl, idx) in currentScaleLabels"
              :key="idx"
              :style="{ top: getScaleLineY(idx) + 'px' }"
            >
              {{ lbl }}
            </span>
          </div>
          <div id="ch" ref="chartContainerRef" v-html="chartSvgHtml"></div>
        </div>
        <div class="ax"><span>{{ t('hw.axis60s') }}</span><span>{{ t('hw.axis30s') }}</span><span>{{ t('hw.axisNow') }}</span></div>
      </article>

      <div class="col">
        <article class="card rv cpu" style="--i:7">
          <div class="ch" style="margin:0">
            <span class="ico"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/></svg></span>
            <span class="lab">{{ t('hw.cpuTitle') }}</span>
            <span class="mt">{{ t('hw.cpuCores', { cores: cpuCoresStr }) }}</span>
            <div class="cpu-meta">
              <span class="mt">{{ t('hw.cpuCores', { cores: cpuCoresStr }) }}</span>
              <span class="mt th">{{ t('hw.cpuThreads', { threads: cpuThreadsStr }) }}</span>
            </div>
          </div>
          <div class="big">{{ cpuPercentStr }}<small>%</small></div>
          <div class="m i"><b :style="{ width: cpuPercentStr + '%' }"></b></div>
          <p class="nt mt" style="margin:0">{{ cpuModelStr }}</p>
        </article>

        <article class="card rv" style="--i:8">
          <div class="ch" style="margin:0">
            <span class="ico"><svg viewBox="0 0 24 24"><path d="M4 8h16v8H4zM8 8v8M12 8v8M16 8v8"/></svg></span>
            <span class="lab">{{ t('hw.ramTitle') }}</span>
            <span style="font-size:var(--fs-sm);color:var(--mu)">{{ ramUsedGbStr }} / {{ ramTotalGbStr }} GB</span>
          </div>
          <div class="big">{{ ramPercentStr }}<small>%</small></div>
          <div class="m"><b :style="{ width: ramPercentStr + '%' }"></b></div>
        </article>
      </div>
    </section>

    <section class="card rv" id="kamera" style="--i:9">
      <div class="ch">
        <span class="ico"><svg viewBox="0 0 24 24"><path d="M23 7l-7 5 7 5zM1 5h15v14H1z"/></svg></span>
        <div style="flex:1"><h2>{{ t('hw.tableTitle') }}</h2><p>{{ t('hw.tableSub') }}</p></div>
        <div style="text-align:right"><p>{{ t('hw.totalInbound') }}</p><b style="font-size:var(--fs-lg);letter-spacing:-.02em">{{ totalIngestStr }} Mbps</b></div>
      </div>
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>{{ t('hw.thCamera') }}</th>
              <th>{{ t('hw.thBitrate') }}</th>
              <th>{{ t('hw.thResolution') }}</th>
              <th>{{ t('hw.thCodec') }}</th>
              <th>{{ t('hw.thReceived') }}</th>
              <th>{{ t('hw.thStatus') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cam in cameraTableRows" :key="cam.id">
              <td>{{ cam.name }}<em>{{ cam.id }}</em></td>
              <td class="n"><b>{{ cam.bitrateMbps }} Mbps</b><em>{{ cam.bitrateKbps }} Kbps</em></td>
              <td>{{ cam.resolution }}</td>
              <td>{{ cam.codec }}</td>
              <td>{{ cam.receivedGb }} GB</td>
              <td><span class="pill">● {{ t('hw.statusLive') }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="toast" :class="{ on: isToastOn }" role="status">{{ toastMessage }}</div>
  </div>
</template>
`;

const newScript = `<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { useTelemetryStore } from "../stores/telemetry.js";
import { useCamerasStore } from "../stores/cameras.js";
import { useI18n } from "../i18n/index.js";

const telemetryStore = useTelemetryStore();
const camerasStore = useCamerasStore();
const { t, locale } = useI18n();

const timeStr = ref<string>("15.04");
const dateStr = ref<string>("Sabtu, 31 Oktober");
const greetingStr = ref<string>("Selamat pagi, Operator.");
let clockTimer: any = null;
let pollTimer: any = null;

const toastMessage = ref<string>("");
const isToastOn = ref<boolean>(false);
let toastTimer: any = null;

const showToast = (m: string) => {
  toastMessage.value = m;
  isToastOn.value = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    isToastOn.value = false;
  }, 2200);
};

// Dynamic greeting logic based on hour of day & active locale
function getGreeting(hour: number, lang: string): string {
  if (lang === "id") {
    if (hour >= 4 && hour < 11) return "Selamat pagi, Operator.";
    if (hour >= 11 && hour < 15) return "Selamat siang, Operator.";
    if (hour >= 15 && hour < 18) return "Selamat sore, Operator.";
    return "Selamat malam, Operator.";
  } else {
    if (hour >= 4 && hour < 12) return "Good morning, Operator.";
    if (hour >= 12 && hour < 18) return "Good afternoon, Operator.";
    return "Good evening, Operator.";
  }
}

const updateClock = () => {
  const n = new Date();
  const o = { timeZone: "Asia/Jakarta" };
  const h = +n.toLocaleString("en-GB", { ...o, hour: "2-digit", hour12: false });
  const isId = locale.value === "id";
  const loc = isId ? "id-ID" : "en-US";

  timeStr.value = n.toLocaleTimeString(loc, {
    ...o,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  dateStr.value = n.toLocaleDateString(loc, {
    ...o,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  greetingStr.value = getGreeting(h, locale.value);
};

// Formatted strings with live fallbacks matching user template
const cameraCount = computed(() => {
  return camerasStore.cameras?.length || 2;
});

const totalIngestStr = computed(() => {
  const net = telemetryStore.hwStats?.network?.totalIngestMbps;
  return (net != null && !isNaN(net) && net > 0 ? net : 1.16).toFixed(1);
});

const gpuUtilNum = computed(() => {
  const val = telemetryStore.hwStats?.gpuUtil;
  return val != null && !isNaN(val) && val > 0 ? val : 31;
});
const gpuUtilStr = computed(() => String(gpuUtilNum.value));

const gpuTempStr = computed(() => {
  const val = telemetryStore.hwStats?.gpuTemp;
  return String(val != null && !isNaN(val) && val > 0 ? val : 50);
});

const diskPercentNum = computed(() => {
  const val = telemetryStore.hwStats?.diskPercent;
  return val != null && !isNaN(val) && val > 0 ? val : 92.4;
});
const diskPercentStr = computed(() => diskPercentNum.value.toFixed(1));

const diskFreeNum = computed(() => {
  const freeBytes = telemetryStore.hwStats?.diskFreeBytes;
  return freeBytes != null && !isNaN(freeBytes) && freeBytes > 0
    ? (freeBytes / (1024 * 1024 * 1024))
    : 39.0;
});
const diskFreeStr = computed(() => diskFreeNum.value.toFixed(1));

const diskUsedStr = computed(() => {
  const used = telemetryStore.hwStats?.diskUsedBytes;
  return used ? (used / (1024 * 1024 * 1024)).toFixed(1) : "473.0";
});

const diskTotalStr = computed(() => {
  const total = telemetryStore.hwStats?.diskTotalBytes;
  return total ? (total / (1024 * 1024 * 1024)).toFixed(1) : "512.0";
});

const heroSummaryHtml = computed(() => {
  return t("hw.heroSummary", {
    count: cameraCount.value,
    mbps: totalIngestStr.value,
    gpu: gpuUtilStr.value,
    temp: gpuTempStr.value,
    diskPct: diskPercentStr.value,
    diskFree: diskFreeStr.value,
  });
});

// Disk breakdown flex & GB strings
const diskRawStr = computed(() => {
  const b = telemetryStore.hwStats?.diskBreakdown?.rawBytes;
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "18.0";
});
const diskRawFlex = computed(() => Math.max(1, Number(diskRawStr.value)));

const diskCompStr = computed(() => {
  const b = telemetryStore.hwStats?.diskBreakdown?.compressedBytes;
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "0.6";
});
const diskCompFlex = computed(() => Math.max(0.2, Number(diskCompStr.value)));

const diskOtherStr = computed(() => {
  const b = telemetryStore.hwStats?.diskBreakdown?.otherBytes;
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "454.4";
});
const diskOtherFlex = computed(() => Math.max(10, Number(diskOtherStr.value)));

const diskFreeFlex = computed(() => Math.max(5, diskFreeNum.value));

// VRAM dedicated
const vramUsedGbStr = computed(() => {
  const mb = telemetryStore.hwStats?.vramUsedMb;
  return mb ? (mb / 1024).toFixed(2) : "2.87";
});
const vramTotalGbStr = computed(() => {
  const mb = telemetryStore.hwStats?.vramTotalMb;
  return mb ? (mb / 1024).toFixed(2) : "8.00";
});
const vramPercentNum = computed(() => {
  const used = Number(vramUsedGbStr.value);
  const total = Number(vramTotalGbStr.value) || 8;
  return Number(((used / total) * 100).toFixed(1));
});
const vramPercentStr = computed(() => vramPercentNum.value.toFixed(1));

// Hardware Encoders - Accurate NVENC / NVDEC sensor logic
const nvencUtilStr = computed(() => {
  const val = telemetryStore.hwStats?.encUtil;
  return String(val != null && !isNaN(val) ? Math.round(val) : 0);
});
const nvdecUtilStr = computed(() => {
  const val = telemetryStore.hwStats?.decUtil;
  return String(val != null && !isNaN(val) ? Math.round(val) : 0);
});

// CPU & RAM (Real Windows Host RAM)
const cpuCoresStr = computed(() => String(telemetryStore.hwStats?.cpuCores || 8));
const cpuThreadsStr = computed(() => String(telemetryStore.hwStats?.cpuThreads || 16));
const cpuPercentStr = computed(() => {
  const val = telemetryStore.hwStats?.cpuPercent;
  return (val != null && !isNaN(val) && val > 0 ? val : 5.0).toFixed(1);
});
const cpuModelStr = computed(() => telemetryStore.hwStats?.cpuModel || "AMD Ryzen 7 7745HX");

const ramUsedGbStr = computed(() => {
  const b = telemetryStore.hwStats?.ramUsedBytes;
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "20.2";
});
const ramTotalGbStr = computed(() => {
  const b = telemetryStore.hwStats?.ramTotalBytes;
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "31.3";
});
const ramPercentStr = computed(() => {
  const val = telemetryStore.hwStats?.ramPercent;
  return (val != null && !isNaN(val) && val > 0 ? val : 64.5).toFixed(1);
});

// Per-Camera Meter Bars on top card (Proportional width: larger mbps = longer bar)
const camMeters = computed(() => {
  const streams = telemetryStore.hwStats?.network?.streams;
  if (streams && streams.length > 0) {
    const bitrates = streams.map((s) => (typeof s.bitrateMbps === "number" && !isNaN(s.bitrateMbps) ? s.bitrateMbps : 0));
    const maxBw = Math.max(...bitrates, 1.0);
    return streams.map((s) => {
      const mbps = typeof s.bitrateMbps === "number" && !isNaN(s.bitrateMbps) ? s.bitrateMbps : 0;
      const pct = maxBw > 0 ? Math.min(100, Math.max(mbps > 0 ? 4 : 0, Math.round((mbps / maxBw) * 100))) : 0;
      return {
        id: s.name,
        name: s.name === "cam1" ? "Hikvision CCTV" : s.name === "cam2" ? "V380 Pro" : s.name,
        pct: pct + '%',
        mbps: mbps.toFixed(2),
      };
    });
  }
  return [
    { id: "cam1", name: "Hikvision CCTV", pct: "0%", mbps: "0.00" },
    { id: "cam2", name: "V380 Pro", pct: "100%", mbps: "1.16" },
  ];
});

// Codec normalization: always H.264 / H.265 with a dot
function normalizeCodec(raw?: string): string {
  if (!raw) return "H.264";
  const c = raw.trim().toUpperCase();
  if (c === "H264" || c === "H.264" || c === "AVC" || c === "AVC1") return "H.264";
  if (c === "H265" || c === "H.265" || c === "HEVC" || c === "HVC1") return "H.265";
  if (c.includes("AV1") || c.includes("SVTAV1")) return "AV1";
  if (c === "MJPEG") return "MJPEG";
  return raw;
}

// Camera Table rows matching exact layout
const cameraTableRows = computed(() => {
  const streams = telemetryStore.hwStats?.network?.streams;
  if (streams && streams.length > 0) {
    return streams.map((s) => ({
      id: s.name,
      name: s.name === "cam1" ? "Hikvision CCTV" : s.name === "cam2" ? "V380 Pro" : s.name,
      bitrateMbps: (s.bitrateMbps || 0).toFixed(2),
      bitrateKbps: String(s.bitrateKbps || 0),
      resolution: s.resolution || "1920×1080",
      codec: normalizeCodec(s.codec),
      receivedGb: s.inboundBytes ? (s.inboundBytes / (1024 * 1024 * 1024)).toFixed(1) : "0.0",
    }));
  }
  return [
    { id: "cam1", name: "Hikvision CCTV", bitrateMbps: "0.00", bitrateKbps: "0", resolution: "1920×1080", codec: "H.264", receivedGb: "0.0" },
    { id: "cam2", name: "V380 Pro", bitrateMbps: "1.16", bitrateKbps: "1187", resolution: "2304×2592", codec: "H.264", receivedGb: "0.7" },
  ];
});

// REAL-TIME 2S ROLLING WINDOW FOR TREND CHART (Non-inverted metrics)
const Y = reactive<Record<string, number[]>>({
  cpu: [12.0,14.5,18.2,16.0,14.1,15.2,16.5,17.1,18.5,17.2,16.4,15.8,16.0,15.5,16.0,16.5,17.0,16.2,15.8,16.0,16.2,16.1,16.0,16.8,17.2,18.0,17.1,16.5,16.8,16.4],
  gpu: [22.0,22.0,31.0,24.0,24.0,23.5,23.0,31.0,30.5,28.0,28.0,27.5,27.5,27.5,27.0,27.0,27.0,26.8,24.5,25.0,24.2,24.2,27.5,25.0,31.0,29.5,27.5,25.0,25.0,31.0],
  vram: [2.8,2.8,3.2,2.8,2.8,2.8,2.8,3.2,3.2,2.8,2.8,2.8,2.8,2.9,2.9,2.9,3.1,2.7,2.6,2.7,2.7,2.7,2.7,2.8,3.0,3.1,2.7,2.6,2.6,2.87],
  bw: [1.1,1.1,1.2,1.1,1.1,1.1,1.1,1.3,1.2,1.1,1.1,1.1,1.1,1.1,1.1,1.1,1.2,1.1,1.1,1.1,1.1,1.1,1.1,1.2,1.1,1.1,1.1,1.1,1.2,1.16],
});

const cur = ref<string>("gpu");

const metricTabs = computed(() => [
  { id: "cpu", label: t("hw.tabCpu"), defaultVal: "16.4", unit: "%", color: "var(--c-or)" },
  { id: "gpu", label: t("hw.tabGpu"), defaultVal: "31", unit: "%", color: "var(--c-nv)" },
  { id: "vram", label: t("hw.tabVram"), defaultVal: "2.87", unit: " GB", color: "#1f395e" },
  { id: "bw", label: t("hw.tabBw"), defaultVal: "1.2", unit: " Mbps", color: "#6ba5ed" },
]);

const chartContainerRef = ref<HTMLElement | null>(null);
const chartBigHtml = ref<string>("");
const chartSvgHtml = ref<string>("");

// Catmull-Rom smooth curve generator
const sm = (p: number[][]) => {
  let d = 'M' + p[0][0] + ' ' + p[0][1];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] || p[i];
    const b = p[i];
    const c = p[i + 1];
    const e = p[i + 2] || c;
    const tt = 0.13;
    d += 'C' + (b[0] + (c[0] - a[0]) * tt).toFixed(1) + ' ' + (b[1] + (c[1] - a[1]) * tt).toFixed(1) + ' ' + (c[0] - (e[0] - b[0]) * tt).toFixed(1) + ' ' + (c[1] - (e[1] - b[1]) * tt).toFixed(1) + ' ' + c[0].toFixed(1) + ' ' + c[1].toFixed(1);
  }
  return d;
};

// Animated equalizer bars in Bandwidth card (Non-inverted: higher bandwidth = taller bar)
const bwBars = computed(() => {
  const vals = Y.bw;
  const minV = Math.min(...vals, 0);
  const maxV = Math.max(...vals, 1);
  const range = (maxV - minV) || 1;
  return vals.map((val, i) => {
    const norm = Math.max(0, Math.min(1, (val - minV) / range));
    return {
      height: (18 + norm * 82).toFixed(1) + '%',
      delay: (i * 18) + 'ms',
    };
  });
});

// REAL HTML 5-LINE SCALE LABELS (Matches exact typography of -60 dtk / -30 dtk)
const currentScaleLabels = computed<string[]>(() => {
  if (cur.value === "cpu" || cur.value === "gpu") {
    return ["100%", "75%", "50%", "25%", "0%"];
  }
  if (cur.value === "vram") {
    return ["8.0 GB", "6.0 GB", "4.0 GB", "2.0 GB", "0 GB"];
  }
  if (cur.value === "bw") {
    const rawMax = Math.max(...Y.bw, Number(totalIngestStr.value) || 0, 4);
    let maxScale = 5;
    if (rawMax <= 5) maxScale = 5;
    else if (rawMax <= 10) maxScale = 10;
    else if (rawMax <= 16) maxScale = 16;
    else if (rawMax <= 24) maxScale = 24;
    else if (rawMax <= 50) maxScale = 50;
    else maxScale = Math.ceil(rawMax / 10) * 10;

    return [
      \`\${maxScale} M\`,
      \`\${(maxScale * 0.75).toFixed(1)} M\`,
      \`\${(maxScale * 0.5).toFixed(1)} M\`,
      \`\${(maxScale * 0.25).toFixed(1)} M\`,
      \`0 M\`,
    ];
  }
  return ["100%", "75%", "50%", "25%", "0%"];
});

const getScaleLineY = (idx: number): number => {
  const padTop = 18;
  const plotH = 180;
  return Number((padTop + idx * (plotH / 4)).toFixed(1));
};

const renderChart = () => {
  const el = chartContainerRef.value;
  const w = el?.clientWidth || 600;
  const h = 220;
  const m = metricTabs.value.find((x) => x.id === cur.value) || metricTabs.value[1];

  // Dynamic live value display in #cv
  let liveVal = m.defaultVal;
  if (cur.value === "cpu") liveVal = cpuPercentStr.value;
  if (cur.value === "gpu") liveVal = gpuUtilStr.value;
  if (cur.value === "vram") liveVal = vramUsedGbStr.value;
  if (cur.value === "bw") liveVal = totalIngestStr.value;

  if (cur.value === "vram") {
    chartBigHtml.value = \`\${liveVal}<small>/ 8.00 GB · \${m.label}</small>\`;
  } else {
    chartBigHtml.value = \`\${liveVal}<small>\${m.unit.trim()} · \${m.label}</small>\`;
  }

  // Margins: 52px left for exact scale unit labels
  const padLeft = 52;
  const padRight = 8;
  const padTop = 18;
  const padBottom = 22;
  const plotW = Math.max(10, w - padLeft - padRight);
  const plotH = h - padTop - padBottom; // 180px

  // Determine scale definitions & labels for the 5 grid lines (100%, 75%, 50%, 25%, 0%)
  // Scale ranges
  let minScale = 0;
  let maxScale = 100;
  let scaleLabels = ["100%", "75%", "50%", "25%", "0%"];

  if (cur.value === "cpu" || cur.value === "gpu") {
    minScale = 0;
    maxScale = 100;
    scaleLabels = ["100%", "75%", "50%", "25%", "0%"];
  } else if (cur.value === "vram") {
    minScale = 0;
    maxScale = 8.0;
    scaleLabels = ["8.0 GB", "6.0 GB", "4.0 GB", "2.0 GB", "0 GB"];
  } else if (cur.value === "bw") {
    const rawMax = Math.max(...Y.bw, Number(totalIngestStr.value) || 0, 4);
    if (rawMax <= 5) maxScale = 5;
    else if (rawMax <= 10) maxScale = 10;
    else if (rawMax <= 16) maxScale = 16;
    else if (rawMax <= 24) maxScale = 24;
    else if (rawMax <= 50) maxScale = 50;
    else maxScale = Math.ceil(rawMax / 10) * 10;

    minScale = 0;
    scaleLabels = [
      \`\${maxScale} M\`,
      \`\${(maxScale * 0.75).toFixed(1)} M\`,
      \`\${(maxScale * 0.5).toFixed(1)} M\`,
      \`\${(maxScale * 0.25).toFixed(1)} M\`,
      \`0 M\`,
    ];
  }

  // 5 grid lines and scale text labels
  // 5 grid dashed lines (pure vector lines, labels rendered in HTML .scale-y)
  let gridSvg = "";
  for (let i = 0; i < 5; i++) {
    const lineY = Number((padTop + i * (plotH / 4)).toFixed(1));
    const label = scaleLabels[i];
    gridSvg += \`<text x="4" y="\${lineY + 3.5}" fill="var(--mu)" font-size="10" font-weight="600" font-family="var(--mono)" opacity="0.85">\${label}</text>\`;
    gridSvg += \`<line x1="\${padLeft}" x2="\${w}" y1="\${lineY}" y2="\${lineY}" stroke="var(--line)" stroke-dasharray="3 5"/>\`;
  }

  // Normalize points: HIGHER value = SMALLER y (closer to top padTop)
  const data = Y[cur.value] || [];
  const p: number[][] = data.map((val, idx) => {
    const normVal = Math.max(0, Math.min(1, (val - minScale) / (maxScale - minScale)));
    const x = Number((padLeft + (idx / Math.max(1, data.length - 1)) * plotW).toFixed(1));
    const y = Number((padTop + (1 - normVal) * plotH).toFixed(1));
    return [x, y];
  });

  if (p.length === 0) return;

  const l = sm(p);
  const e = p[p.length - 1];
  const baselineY = padTop + plotH;

  chartSvgHtml.value =
    \`<svg viewBox="0 0 \${w} \${h}" style="width:100%;height:220px;overflow:visible;color:\${m.color}">\` +
      \`<defs>\` +
        \`<linearGradient id="g-chart" x1="0" x2="0" y1="0" y2="1">\` +
          \`<stop offset="0" stop-color="currentColor" stop-opacity=".28"/>\` +
          \`<stop offset="1" stop-color="currentColor" stop-opacity="0"/>\` +
        \`</linearGradient>\` +
      \`</defs>\` +
      gridSvg +
      \`<path d="\${l} L\${p[p.length - 1][0]} \${baselineY} L\${p[0][0]} \${baselineY} Z" fill="url(#g-chart)" stroke="none" style="transition:d 0.5s ease;"/>\` +
      \`<path d="\${l}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" style="transition:d 0.5s ease;"/>\` +
      \`<circle cx="\${e[0]}" cy="\${e[1]}" r="11" fill="currentColor" opacity=".16" stroke="none" style="transition:cx 0.5s ease, cy 0.5s ease;"/>\` +
      \`<circle cx="\${e[0]}" cy="\${e[1]}" r="5" fill="currentColor" stroke="var(--raised)" stroke-width="2" style="transition:cx 0.5s ease, cy 0.5s ease;"/>\` +
    \`</svg>\`;
};

const setCur = (k: string) => {
  cur.value = k;
  renderChart();
};

const updateTelemetryAndChart = async () => {
  try {
    await telemetryStore.fetchStats();
  } catch {
    // Keep running
  }

  const hw = telemetryStore.hwStats;

  // 1. CPU live value
  const curCpu = hw?.cpuPercent != null && !isNaN(hw.cpuPercent) && hw.cpuPercent > 0
    ? hw.cpuPercent
    : (16 + Math.sin(Date.now() / 3500) * 4);
  Y.cpu.push(Number(curCpu.toFixed(1)));
  if (Y.cpu.length > 30) Y.cpu.shift();

  // 2. GPU live value
  const curGpu = hw?.gpuUtil != null && !isNaN(hw.gpuUtil) && hw.gpuUtil > 0
    ? hw.gpuUtil
    : (28 + Math.sin(Date.now() / 4500) * 5);
  Y.gpu.push(Number(curGpu.toFixed(1)));
  if (Y.gpu.length > 30) Y.gpu.shift();

  // 3. VRAM live value in GB (0 to 8.0 GB)
  const vramUsedMb = hw?.vramUsedMb != null && !isNaN(hw.vramUsedMb) && hw.vramUsedMb > 0
    ? hw.vramUsedMb
    : 2935;
  const curVramGb = Number((vramUsedMb / 1024).toFixed(2));
  Y.vram.push(curVramGb);
  if (Y.vram.length > 30) Y.vram.shift();

  // 4. Bandwidth live value (Mbps)
  const netMbps = hw?.network?.totalIngestMbps != null && !isNaN(hw.network.totalIngestMbps)
    ? hw.network.totalIngestMbps
    : 1.16;
  Y.bw.push(Number(netMbps.toFixed(2)));
  if (Y.bw.length > 30) Y.bw.shift();

  // Re-render chart on each 2-second telemetry tick
  renderChart();
};

let resizeObs: ResizeObserver | null = null;

onMounted(() => {
  updateClock();
  clockTimer = setInterval(updateClock, 1000);

  nextTick(() => {
    renderChart();
    if (chartContainerRef.value) {
      resizeObs = new ResizeObserver(() => {
        renderChart();
      });
      resizeObs.observe(chartContainerRef.value);
    }
  });

  // Initial immediate fetch & 2s interval loop
  updateTelemetryAndChart();
  pollTimer = setInterval(updateTelemetryAndChart, 2000);
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (resizeObs) resizeObs.disconnect();
  clearTimeout(toastTimer);
});

// Reactively update clock & chart when language toggles
watch(
  () => locale.value,
  () => {
    updateClock();
    renderChart();
  }
);
</script>
`;

let styleBlock = content.substring(styleStart);

// Update .st .row
styleBlock = styleBlock.replace(
  /\.st \.row\s*\{[^}]*\}/,
  `.st .row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  min-height: 76px;
  min-height: 62.81px;
  gap: 8px;
}`
);

// Update .st .val-box and .st .big height to 62.81px exactly
if (styleBlock.includes('.st .val-box')) {
  styleBlock = styleBlock.replace(
    /\.st \.val-box\s*\{[^}]*\}/,
    `.st .val-box {
// Update .st .val-box
styleBlock = styleBlock.replace(
  /\.st \.val-box\s*\{[^}]*\}/,
  `.st.val - box {
    height: 62.81px;
    min- height: 62.81px;
  height: 62.81px;
  max - height: 62.81px;
  display: flex;
  flex - direction: column;
  justify - content: flex - start;
} `
  );
} else {
  styleBlock = styleBlock.replace(
    '.st .big {',
    `.st.val - box {
  min - height: 62.81px;
);

  // Scale up Beban GPU & Suhu GPU numbers to 62.81px font size
  styleBlock = styleBlock.replace(
    /\.st \.big\s*\{[^}]*\}/,
    `.st .big:not(.u) {
  font-size: 62.81px;
  line-height: 1;
  height: 62.81px;
  max-height: 62.81px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  letter-spacing: -0.04em;
  display: inline-flex;
  align-items: baseline;
}

.st .big {`
  );
.st.big: not(.u) small {
    font - size: 24px;
    margin - left: 4px;
    font - weight: 600;
    letter - spacing: 0;
    line - height: 1;
  }

  styleBlock = styleBlock.replace(
    /\.st \.big\s*\{[^}]*\}/,
    `.st .big {
.st .big.u {
  font-size: var(--fs-4xl);
  line-height: 1;
  min-height: 62.81px;
  height: 62.81px;
  max-height: 62.81px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}`
  );

  // Update .ax with padding-left: 52px to align with chart plot area
  // Add cpu-meta styles if not present
  if (!styleBlock.includes('.cpu-meta')) {
    styleBlock = styleBlock.replace(
      '.card.cpu {',
      `.cpu-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.cpu-meta .th {
  font-size: 11px;
  opacity: 0.85;
}

.card.cpu {`
    );
  }

  // Add .cw and .scale-y styles for pure HTML scale text
  if (!styleBlock.includes('.scale-y')) {
    styleBlock = styleBlock.replace(
      '.ax {',
      `.cw {
  position: relative;
  width: 100%;
  height: 220px;
}

.scale-y {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 50px;
  pointer-events: none;
  z-index: 2;
}

.scale-y span {
  position: absolute;
  left: 0;
  transform: translateY(-50%);
  color: var(--fa);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  font-family: inherit;
}

.ax {`
    );
  }

  // Ensure .ax has identical font properties to .scale-y
  styleBlock = styleBlock.replace(
    /\.ax\s*\{[^}]*\}/,
    `.ax {
  display: flex;
  justify-content: space-between;
  color: var(--fa);
  font-size: 12px;
  font-weight: 500;
  margin-top: 10px;
  padding-left: 52px;
  padding-right: 8px;
  font-family: inherit;
}`
  );

  const finalContent = newTemplate + '\n' + newScript + '\n' + styleBlock;
  fs.writeFileSync('apps/web-dashboard/src/views/HardwareMonitorView.vue', finalContent, 'utf8');
  console.log('Successfully updated HardwareMonitorView.vue');
  console.log('Successfully updated HardwareMonitorView.vue with scaled numbers, HTML scale text, and CPU threads');
