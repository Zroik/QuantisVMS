<template>
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
        <p>{{ heroSummary }}</p>
        <div class="acts">
          <router-link :to="{ name: 'configuration', query: { tab: 'storage' } }" class="btn p">{{ t('hw.btnRetention') }}</router-link>
          <button class="btn o" type="button" @click="showToast(t('hw.exportToast'))">{{ t('hw.btnExport') }}</button>
        </div>
        <div class="ch" style="margin-bottom:12px">
          <span class="ico"><svg viewBox="0 0 24 24"><path d="M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg></span>
          <div style="flex:1"><h2>{{ t('hw.diskTitle') }}</h2><p>{{ t('hw.diskPath') }}</p></div>
          <div style="text-align:right"><b :style="{ fontSize: '20px', color: diskPercentNum >= 85 ? 'var(--warn)' : 'var(--tx)', letterSpacing: '-.02em' }">{{ diskPercentStr }}%</b><p>{{ diskUsedStr }} / {{ diskTotalStr }} GB</p></div>
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
          <div><span><i style="background:var(--well);box-shadow:inset 0 0 0 1px var(--line)"></i>{{ t('hw.diskFree') }}</span><b :style="{ color: diskPercentNum >= 85 ? 'var(--warn)' : 'var(--tx)' }">{{ diskFreeStr }} GB</b></div>
        </div>
      </article>

      <article class="card rv" id="bwc" style="--i:1">
        <div class="ch">
          <span class="ico"><svg viewBox="0 0 24 24"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/></svg></span>
          <h2>{{ t('hw.bandwidthIn') }}</h2>
          <a href="#kamera" class="btn o s">{{ t('hw.btnCameras') }} <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></a>
        </div>
        <div class="big">{{ totalIngestStr }} <small>Mbps</small> <span class="pill">● {{ t('hw.badgeActive', { count: activeCameraCount }) }}</span></div>
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
        <div class="big" id="cv">{{ chartBigVal }} <small>{{ chartBigSub }}</small></div>
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
            <div class="cpu-meta">
              <span class="mt">{{ t('hw.cpuCores', { cores: cpuCoresStr }) }}</span>
              <span class="mt th">{{ t('hw.cpuThreads', { threads: cpuThreadsStr }) }}</span>
            </div>
          </div>
          <div class="cpu-body">
            <div class="big">{{ cpuPercentStr }}<small>%</small></div>
            <div class="m i"><b :style="{ width: cpuPercentStr + '%' }"></b></div>
            <p class="nt mt" style="margin:0">{{ cpuModelStr }}</p>
          </div>
        </article>

        <article class="card rv ram-card" style="--i:8">
          <div class="ch" style="margin:0">
            <span class="ico"><svg viewBox="0 0 24 24"><path d="M4 8h16v8H4zM8 8v8M12 8v8M16 8v8"/></svg></span>
            <span class="lab">{{ t('hw.ramTitle') }}</span>
          </div>

          <div class="ram-body">
            <!-- Windows Host RAM -->
            <div class="ram-item">
              <div class="ram-hd">
                <span class="ram-name">
                  <svg viewBox="0 0 24 24" class="os-ico win" fill="currentColor"><path d="M3 5.5 10.5 4.5v6.5H3V5.5zm8.5-1.1L21 3v8h-9.5V4.4zM3 12.5h7.5V19l-7.5-1v-5.5zm8.5 0H21v7.6l-9.5-1.4v-6.2z"/></svg>
                  {{ t('hw.ramHost') }}
                </span>
                <span class="ram-meta">
                  <b class="ram-pct">{{ ramPercentStr }}%</b>
                  <small class="ram-dim">{{ ramUsedGbStr }} / {{ ramTotalGbStr }} GB</small>
                </span>
              </div>
              <div class="m win"><b :style="{ width: ramPercentStr + '%' }"></b></div>
            </div>

            <!-- WSL2 MicroVM RAM -->
            <div class="ram-item">
              <div class="ram-hd">
                <span class="ram-name">
                  <svg viewBox="0 0 24 24" class="os-ico wsl" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 10 3 2-3 2M13 14h3"/></svg>
                  {{ t('hw.ramWsl') }}
                </span>
                <span class="ram-meta">
                  <b class="ram-pct">{{ wslRamPercentStr }}%</b>
                  <small class="ram-dim">{{ wslRamUsedGbStr }} / {{ wslRamTotalGbStr }} GB</small>
                </span>
              </div>
              <div class="m wsl"><b :style="{ width: wslRamPercentStr + '%' }"></b></div>
            </div>
          </div>
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
              <td><span class="pill" :class="{ off: !cam.isLive }">● {{ cam.isLive ? t('hw.statusLive') : t('hw.statusOffline') }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="toast" :class="{ on: isToastOn }" role="status">{{ toastMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { useTelemetryStore } from "../stores/telemetry.js";
import { useCamerasStore } from "../stores/cameras.js";
import { useAuthStore } from "../stores/auth.js";
import { useI18n } from "../i18n/index.js";

const telemetryStore = useTelemetryStore();
const camerasStore = useCamerasStore();
const authStore = useAuthStore();
const { t, locale } = useI18n();

const timeStr = ref<string>("15.04");
const dateStr = ref<string>("Sabtu, 31 Oktober");
const greetingStr = ref<string>("Selamat malam, Operator.");
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
function getGreeting(hour: number, lang: string, name?: string): string {
  const who = name || "Operator";
  if (lang === "id") {
    if (hour >= 4 && hour < 11) return `Selamat pagi, ${who}.`;
    if (hour >= 11 && hour < 15) return `Selamat siang, ${who}.`;
    if (hour >= 15 && hour < 18) return `Selamat sore, ${who}.`;
    return `Selamat malam, ${who}.`;
  } else {
    if (hour >= 4 && hour < 12) return `Good morning, ${who}.`;
    if (hour >= 12 && hour < 18) return `Good afternoon, ${who}.`;
    return `Good evening, ${who}.`;
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

  greetingStr.value = getGreeting(h, locale.value, authStore.user?.username);
};

// Active camera count (only cameras with live ready streams and > 0 mbps)
const activeCameraCount = computed(() => {
  const streams = telemetryStore.hwStats?.network?.streams;
  if (streams && streams.length > 0) {
    return streams.filter((s) => s.ready && s.bitrateMbps > 0).length;
  }
  return 0;
});

const totalIngestStr = computed(() => {
  const net = telemetryStore.hwStats?.network?.totalIngestMbps;
  return (net != null && !isNaN(net) ? net : 0).toFixed(1);
});

const gpuUtilNum = computed(() => {
  const val = telemetryStore.hwStats?.gpuUtil;
  return val != null && !isNaN(val) ? val : 0;
});
const gpuUtilStr = computed(() => String(gpuUtilNum.value));

const gpuTempStr = computed(() => {
  const val = telemetryStore.hwStats?.gpuTemp;
  return String(val != null && !isNaN(val) ? val : 0);
});

const diskPercentNum = computed(() => {
  const val = telemetryStore.hwStats?.diskPercent;
  return val != null && !isNaN(val) ? val : 0;
});
const diskPercentStr = computed(() => diskPercentNum.value.toFixed(1));

const diskFreeNum = computed(() => {
  const freeBytes = telemetryStore.hwStats?.diskFreeBytes;
  return freeBytes != null && !isNaN(freeBytes)
    ? (freeBytes / (1024 * 1024 * 1024))
    : 0;
});
const diskFreeStr = computed(() => diskFreeNum.value.toFixed(1));

const diskUsedStr = computed(() => {
  const used = telemetryStore.hwStats?.diskUsedBytes;
  return used ? (used / (1024 * 1024 * 1024)).toFixed(1) : "0.0";
});

const diskTotalStr = computed(() => {
  const total = telemetryStore.hwStats?.diskTotalBytes;
  return total ? (total / (1024 * 1024 * 1024)).toFixed(1) : "0.0";
});

const heroSummary = computed(() => {
  return t("hw.heroSummary", {
    count: activeCameraCount.value,
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
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "0.0";
});
const diskRawFlex = computed(() => Math.max(0.2, Number(diskRawStr.value)));

const diskCompStr = computed(() => {
  const b = telemetryStore.hwStats?.diskBreakdown?.compressedBytes;
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "0.0";
});
const diskCompFlex = computed(() => Math.max(0.1, Number(diskCompStr.value)));

const diskOtherStr = computed(() => {
  const b = telemetryStore.hwStats?.diskBreakdown?.otherBytes;
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "0.0";
});
const diskOtherFlex = computed(() => Math.max(1, Number(diskOtherStr.value)));

const diskFreeFlex = computed(() => Math.max(1, diskFreeNum.value));

// VRAM dedicated
const vramUsedGbStr = computed(() => {
  const mb = telemetryStore.hwStats?.vramUsedMb;
  return mb ? (mb / 1024).toFixed(2) : "0.00";
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
  return (val != null && !isNaN(val) ? val : 0.0).toFixed(1);
});
const cpuModelStr = computed(() => telemetryStore.hwStats?.cpuModel || "Host CPU");

const ramUsedGbStr = computed(() => {
  const b = telemetryStore.hwStats?.ramUsedBytes;
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "0.0";
});
const ramTotalGbStr = computed(() => {
  const b = telemetryStore.hwStats?.ramTotalBytes;
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "32.0";
});
const ramPercentStr = computed(() => {
  const val = telemetryStore.hwStats?.ramPercent;
  return (val != null && !isNaN(val) ? val : 0.0).toFixed(1);
});

const wslRamUsedGbStr = computed(() => {
  const b = telemetryStore.hwStats?.wslRamUsedBytes;
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "0.0";
});
const wslRamTotalGbStr = computed(() => {
  const b = telemetryStore.hwStats?.wslRamTotalBytes;
  return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "11.7";
});
const wslRamPercentStr = computed(() => {
  const val = telemetryStore.hwStats?.wslRamPercent;
  return (val != null && !isNaN(val) ? val : 0.0).toFixed(1);
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
      const camObj = camerasStore.cameras.find((c) => `cam${c.id}` === s.name || c.stream_path === s.name);
      return {
        id: s.name,
        name: camObj?.name || s.name,
        pct: pct + '%',
        mbps: mbps.toFixed(2),
      };
    });
  }
  return [];
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
  const streams = telemetryStore.hwStats?.network?.streams || [];
  if (camerasStore.cameras.length > 0) {
    return camerasStore.cameras.map((cam) => {
      const streamName = cam.stream_path || `cam${cam.parent_camera_id || cam.id}`;
      const s = streams.find((it) => it.name === streamName);
      const split = cam.split_count || 1;
      const res = (s?.ready && s?.resolution && s.resolution !== "N/A") ? s.resolution : "—";
      const isLive = Boolean(s?.ready && s?.bitrateMbps != null && s.bitrateMbps > 0);
      const rawBitrateMbps = isLive ? (s?.bitrateMbps ?? 0) : 0;
      // Child slices share the parent stream; do not invent per-slice figures.
      const sliceBitrateMbps = split > 1 ? null : rawBitrateMbps;
      const sliceInbound = split > 1 ? null : (s?.inboundBytes ?? 0);

      return {
        id: `cam${cam.id}`,
        name: cam.name,
        isLive,
        bitrateMbps: sliceBitrateMbps === null ? "—" : sliceBitrateMbps.toFixed(2),
        bitrateKbps: sliceBitrateMbps === null ? "—" : String(Math.round(sliceBitrateMbps * 1024)),
        resolution: res,
        codec: normalizeCodec(s?.codec || "unknown"),
        receivedGb: sliceInbound === null ? "—" : (sliceInbound / (1024 * 1024 * 1024)).toFixed(1),
      };
    });
  }
  return [];
});

const cur = ref<string>("gpu");

const metricTabs = computed(() => [
  { id: "cpu", label: t("hw.tabCpu"), defaultVal: "0.0", unit: "%", color: "var(--c-or)" },
  { id: "gpu", label: t("hw.tabGpu"), defaultVal: "0", unit: "%", color: "var(--c-nv)" },
  { id: "vram", label: t("hw.tabVram"), defaultVal: "0.00", unit: " GB", color: "var(--sky)" },
  { id: "bw", label: t("hw.tabBw"), defaultVal: "0.0", unit: " Mbps", color: "var(--iris)" },
]);

const chartContainerRef = ref<HTMLElement | null>(null);
const chartBigVal = ref<string>("");
const chartBigSub = ref<string>("");
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

// Animated equalizer bars in Bandwidth card (Directly reactive to telemetryStore.historyNet)
const bwBars = computed(() => {
  const vals = telemetryStore.historyNet.length > 0 ? telemetryStore.historyNet : [0];
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
    const rawMax = Math.max(...telemetryStore.historyNet, Number(totalIngestStr.value) || 0, 4);
    let maxScale = 5;
    if (rawMax <= 5) maxScale = 5;
    else if (rawMax <= 10) maxScale = 10;
    else if (rawMax <= 16) maxScale = 16;
    else if (rawMax <= 24) maxScale = 24;
    else if (rawMax <= 50) maxScale = 50;
    else maxScale = Math.ceil(rawMax / 10) * 10;

    return [
      `${maxScale} Mbps`,
      `${(maxScale * 0.75).toFixed(1)} Mbps`,
      `${(maxScale * 0.5).toFixed(1)} Mbps`,
      `${(maxScale * 0.25).toFixed(1)} Mbps`,
      `0 Mbps`,
    ];
  }
  return ["100%", "75%", "50%", "25%", "0%"];
});

const getScaleLineY = (idx: number): number => {
  const padTop = 18;
  const plotH = 200;
  return Number((padTop + idx * (plotH / 4)).toFixed(1));
};

const renderChart = () => {
  const el = chartContainerRef.value;
  const w = el?.clientWidth || 600;
  const h = 240;
  const m = metricTabs.value.find((x) => x.id === cur.value) || metricTabs.value[1];

  // Dynamic live value display in #cv
  let liveVal = m.defaultVal;
  if (cur.value === "cpu") liveVal = cpuPercentStr.value;
  if (cur.value === "gpu") liveVal = gpuUtilStr.value;
  if (cur.value === "vram") liveVal = vramUsedGbStr.value;
  if (cur.value === "bw") liveVal = totalIngestStr.value;

  chartBigVal.value = liveVal;
  if (cur.value === "vram") {
    chartBigSub.value = `/ ${vramTotalGbStr.value} GB · ${m.label}`;
  } else {
    chartBigSub.value = `${m.unit.trim()} · ${m.label}`;
  }

  // Margins: 60px left for exact scale unit labels
  const padLeft = 60;
  const padRight = 8;
  const padTop = 18;
  const padBottom = 22;
  const plotW = Math.max(10, w - padLeft - padRight);
  const plotH = h - padTop - padBottom; // 180px

  // Scale ranges
  let minScale = 0;
  let maxScale = 100;
  if (cur.value === "cpu" || cur.value === "gpu") {
    minScale = 0;
    maxScale = 100;
  } else if (cur.value === "vram") {
    minScale = 0;
    maxScale = Number(vramTotalGbStr.value) || 8.0;
  } else if (cur.value === "bw") {
    const rawMax = Math.max(...telemetryStore.historyNet, Number(totalIngestStr.value) || 0, 4);
    if (rawMax <= 5) maxScale = 5;
    else if (rawMax <= 10) maxScale = 10;
    else if (rawMax <= 16) maxScale = 16;
    else if (rawMax <= 24) maxScale = 24;
    else if (rawMax <= 50) maxScale = 50;
    else maxScale = Math.ceil(rawMax / 10) * 10;
    minScale = 0;
  }

  // 5 grid dashed lines
  let gridSvg = "";
  for (let i = 0; i < 5; i++) {
    const lineY = Number((padTop + i * (plotH / 4)).toFixed(1));
    gridSvg += `<line x1="${padLeft}" x2="${w}" y1="${lineY}" y2="${lineY}" stroke="var(--line)" stroke-dasharray="3 5"/>`;
  }

  // Single source of truth from telemetryStore
  const data = cur.value === "cpu"
    ? telemetryStore.historyCpu
    : cur.value === "gpu"
    ? telemetryStore.historyGpu
    : cur.value === "vram"
    ? telemetryStore.historyVram
    : telemetryStore.historyNet;

  if (!data || data.length === 0) return;

  const p: number[][] = data.map((val, idx) => {
    const normVal = Math.max(0, Math.min(1, (val - minScale) / (maxScale - minScale)));
    const x = Number((padLeft + (idx / Math.max(1, data.length - 1)) * plotW).toFixed(1));
    const y = Number((padTop + (1 - normVal) * plotH).toFixed(1));
    return [x, y];
  });

  const l = sm(p);
  const e = p[p.length - 1];
  const baselineY = padTop + plotH;

  chartSvgHtml.value =
    `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:240px;overflow:visible;color:${m.color}">` +
      `<defs>` +
        `<linearGradient id="g-chart" x1="0" x2="0" y1="0" y2="1">` +
          `<stop offset="0" stop-color="currentColor" stop-opacity=".28"/>` +
          `<stop offset="1" stop-color="currentColor" stop-opacity="0"/>` +
        `</linearGradient>` +
      `</defs>` +
      gridSvg +
      `<path d="${l} L${p[p.length - 1][0]} ${baselineY} L${p[0][0]} ${baselineY} Z" fill="url(#g-chart)" stroke="none" style="transition:d 0.5s ease;"/>` +
      `<path d="${l}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" style="transition:d 0.5s ease;"/>` +
      `<circle cx="${e[0]}" cy="${e[1]}" r="11" fill="currentColor" opacity=".16" stroke="none" style="transition:cx 0.5s ease, cy 0.5s ease;"/>` +
      `<circle cx="${e[0]}" cy="${e[1]}" r="5" fill="currentColor" stroke="var(--raised)" stroke-width="2" style="transition:cx 0.5s ease, cy 0.5s ease;"/>` +
    `</svg>`;
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

<style scoped>
/* EXACT USER DESIGN STYLES */
.hw-view {
  min-width: 0;
  width: 100%;
  padding: 24px clamp(16px, 2vw, 32px) 48px;
}

.crumb {
  margin: 0 0 2px;
  color: var(--mu);
  font-size: var(--fs-sm);
  display: flex;
  align-items: center;
  gap: 6px;
}

.crumb svg {
  width: 12px;
  height: 12px;
}

.crumb b {
  color: var(--iris);
  font-weight: 600;
}

.hd {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}

h1 {
  font-size: var(--fs-h1);
  line-height: 1.15;
  letter-spacing: -.02em;
  font-weight: 600;
}

.chip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  border-radius: 999px;
  background: var(--glass2);
  box-shadow: 0 0 0 1px var(--rim), var(--sh);
  font-size: var(--fs-sm);
}

.chip hr {
  width: 1px;
  height: 26px;
  border: 0;
  background: var(--line);
}

.chip small {
  display: block;
  color: var(--mu);
  font-size: 12px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--good);
  box-shadow: 0 0 0 4px #23a05c24;
}

.g {
  display: grid;
  gap: 16px;
  margin-bottom: 16px;
}

.a {
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
}

.k {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.c {
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
}

.card {
  position: relative;
  min-width: 0;
  padding: 20px;
  border-radius: 24px;
  background: var(--glass);
  box-shadow: 0 0 0 1px var(--rim), var(--sh);
}

.rv {
  animation: up .6s var(--ease) both;
  animation-delay: calc(var(--i, 0) * 60ms);
}

@keyframes up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}

.ch {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  margin-bottom: 14px;
}

.ch h2, .lab {
  font-size: var(--fs-md);
  font-weight: 600;
  flex: 1;
  letter-spacing: -.005em;
}

.ch h2 {
  font-size: var(--fs-lg);
}

.ch p {
  font-size: var(--fs-sm);
  color: var(--mu);
  font-weight: 500;
}

.ico {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--raised);
  display: grid;
  place-items: center;
  flex: none;
  box-shadow: 0 0 0 1px var(--line);
}

.ico svg {
  width: 18px;
  height: 18px;
}

.btn {
  position: relative;
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  font-size: var(--fs-md);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  transition: transform .12s, background-color .18s;
  text-decoration: none;
}

.btn.p {
  background: var(--ink);
  color: var(--oi);
}

.btn.o {
  box-shadow: inset 0 0 0 1px var(--line);
  background: var(--glass);
  color: var(--tx);
}

.btn.o:hover {
  background: var(--well);
}

.btn.s {
  height: 32px;
  padding: 0 10px 0 14px;
  font-size: var(--fs-sm);
}

.btn.s::after {
  content: "";
  position: absolute;
  inset: -4px 0;
}

.btn.s svg {
  width: 12px;
  height: 12px;
}

.eb {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--coral);
}

.hero h2 {
  font-size: var(--fs-2xl);
  letter-spacing: -.02em;
  line-height: 1.2;
  font-weight: 600;
  margin: 6px 0 8px;
}

.hero p {
  color: var(--mu);
  max-width: 56ch;
}

.hero p b {
  color: var(--tx);
  font-weight: 600;
}

.hero p em {
  font-style: normal;
  color: var(--warn);
  font-weight: 600;
}

.acts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 16px 0 24px;
}

.stack {
  display: flex;
  gap: 3px;
  height: 14px;
}

.stack span {
  border-radius: 99px;
  min-width: 7px;
  transform-origin: left;
  animation: gr .9s var(--ease) both;
}

.leg {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.leg span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--mu);
  font-size: var(--fs-sm);
  font-weight: 600;
}

.leg i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.leg b {
  display: block;
  font-size: var(--fs-xl);
  font-weight: 600;
  letter-spacing: -.02em;
  margin-top: 2px;
}

.big {
  font-size: var(--fs-3xl);
  font-weight: 600;
  letter-spacing: -.035em;
  line-height: 1.1;
}

.big small {
  font-size: 14px;
  color: var(--mu);
  font-weight: 600;
  letter-spacing: 0;
  margin-left: 5px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 600;
  background: #23a05c1f;
  color: var(--good);
}

.pill.off {
  background: var(--well);
  color: var(--mu);
}

.bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 72px;
  margin: 14px 0;
}

.bars i {
  flex: 1;
  border-radius: 4px;
  background: var(--iris);
  opacity: .35;
  transform-origin: bottom;
  animation: gv .7s var(--ease) both;
}

.bars i:last-child {
  opacity: 1;
}

@keyframes gv {
  from {
    transform: scaleY(.1);
  }
}

@keyframes gr {
  from {
    transform: scaleX(0);
  }
}

.cam {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 4px 10px;
  align-items: center;
  font-size: var(--fs-sm);
  margin-top: 8px;
}

.cam > div {
  height: 6px;
  border-radius: 99px;
  background: var(--well);
  overflow: hidden;
}

.cam > div b {
  display: block;
  height: 100%;
  background: var(--iris);
  border-radius: 99px;
  transform-origin: left;
  animation: gr .9s var(--ease) both;
}

.st {
  display: grid;
  gap: 10px;
  align-content: start;
  padding: 16px 18px;
}

.st .lab {
  color: inherit;
}

.st .ico {
  width: 34px;
  height: 34px;
}

.st.ink {
  background: var(--nv);
  color: var(--on-fill);
  box-shadow: 0 20px 40px -22px #000a;
}

.st.ink .ico {
  background: #0000001f;
  box-shadow: none;
}

.st.acc {
  background: var(--navy);
  color: var(--on-navy);
}

.st.acc .ico {
  background: #ffffff1f;
  box-shadow: none;
}

.st .row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  min-height: 62.81px;
  gap: 8px;
}

.st.ink .big small, .st.acc .big small {
  color: inherit;
  opacity: .75;
}

.nt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  font-weight: 600;
  margin-top: 6px;
  opacity: .85;
}

.nt svg {
  width: 13px;
  height: 13px;
}

.nt.ok {
  color: var(--good);
  opacity: 1;
}

.ring {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: conic-gradient(var(--rc, var(--coral)) calc(var(--p) * 1%), var(--rt, var(--well)) 0);
  -webkit-mask: radial-gradient(circle, #0000 28px, #000 29px);
  mask: radial-gradient(circle, #0000 28px, #000 29px);
  flex: none;
}

.st.ink .ring {
  --rc: #111;
  --rt: #00000024;
}

.st.acc .ring {
  --rc: #6ba5ed;
  --rt: #ffffff29;
}

.eng {
  display: grid;
  gap: 8px;
  font-size: var(--fs-sm);
  font-weight: 600;
}

.eng div {
  display: flex;
  justify-content: space-between;
}

.m {
  height: 10px;
  border-radius: 99px;
  background: var(--well);
  overflow: hidden;
}

.m b {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: var(--ink);
  transform-origin: left;
  animation: gr 1s var(--ease) both;
}

.m.i b {
  background: var(--iris);
}

.eng .m {
  height: 7px;
}

.seg {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  display: inline-flex;
  padding: 3px;
  border-radius: 99px;
  background: var(--well);
}

.seg button {
  height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  font-weight: 600;
  font-size: var(--fs-sm);
  color: var(--mu);
  transition: background-color .18s, color .18s, transform .12s;
  border: 0;
  background: none;
  cursor: pointer;
}

.seg button:active {
  transform: scale(.96);
}

.seg button[aria-pressed="true"] {
  background: var(--raised);
  color: var(--tx);
  box-shadow: 0 1px 3px #0002;
}

#ch {
  height: 240px;
  margin-top: 8px;
}

:deep(#ch svg) {
  width: 100%;
  height: 240px;
  overflow: visible;
  animation: fd .4s var(--ease);
}

@keyframes fd {
  from {
    opacity: 0;
  }
}

.cw {
  position: relative;
  width: 100%;
  height: 240px;
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

.ax {
  display: flex;
  justify-content: space-between;
  color: var(--fa);
  font-size: 12px;
  font-weight: 500;
  margin-top: 10px;
  padding-left: 52px;
  padding-right: 8px;
  font-family: inherit;
}

.col {
  display: grid;
  grid-template-rows: 1fr 1fr;
  gap: 16px;
  height: 100%;
}

.col .card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  box-sizing: border-box;
}

.ram-card {
  display: flex;
  flex-direction: column;
}

.ram-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  justify-content: center;
}

.ram-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ram-hd {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ram-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--tx);
}

.os-ico {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.os-ico.win {
  color: var(--iris);
}

.os-ico.wsl {
  color: var(--teal);
}

.ram-meta {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.ram-pct {
  font-size: 14px;
  font-weight: 700;
  color: var(--tx);
}

.ram-dim {
  font-size: 12px;
  color: var(--mu);
  font-weight: 500;
}

.m.win b {
  background: var(--iris);
}

.m.wsl b {
  background: var(--teal);
}

.cpu-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  justify-content: center;
}

/* TABLE EXACT STYLING */
.tw {
  overflow-x: auto;
  margin: 0 -8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 620px;
}

th {
  text-align: left;
  font-size: 12px;
  color: var(--mu);
  font-weight: 600;
  padding: 8px 12px;
}

td {
  padding: 14px 12px;
  border-top: 1px solid var(--line);
  font-weight: 600;
}

tbody tr {
  transition: background-color .15s;
}

tbody tr:hover {
  background: var(--well);
}

td em {
  font-style: normal;
  color: var(--mu);
  font-weight: 500;
  font-size: 12px;
  margin-left: 6px;
}

td.n b {
  display: block;
  font-weight: 700;
}

td.n em {
  margin: 0;
}

.toast {
  position: fixed;
  top: calc(16px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translate(-50%, -12px);
  opacity: 0;
  pointer-events: none;
  background: var(--ink);
  color: var(--oi);
  padding: 10px 18px;
  border-radius: 999px;
  font-weight: 600;
  transition: opacity .2s, transform .25s var(--ease);
  z-index: 60;
}

.toast.on {
  opacity: 1;
  transform: translate(-50%, 0);
}

:focus-visible {
  outline: 2px solid var(--iris);
  outline-offset: 2px;
}

.st .val-box {
  height: 62.81px;
  min-height: 62.81px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.st .big:not(.u) {
  font-size: 62.81px;
  line-height: 1;
  height: 62.81px;
  letter-spacing: -0.04em;
  display: inline-flex;
  align-items: baseline;
}

.st .big:not(.u) small {
  font-size: 24px;
  margin-left: 4px;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1;
}

.st .big.u {
  font-size: var(--fs-4xl);
  line-height: 1;
  height: 62.81px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.st .big.u small {
  display: block;
  margin: 4px 0 0;
}

.mt {
  color: var(--mu);
  font-size: var(--fs-sm);
}

.cpu-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.cpu-meta .th {
  font-size: 11px;
  opacity: 0.85;
}

.card.cpu {
  background: var(--orange);
  color: var(--on-fill);
}

.cpu .ico {
  background: #0000001f;
  box-shadow: none;
}

.cpu .m {
  background: #00000024;
}

.cpu .m b {
  background: #111;
}

.cpu .mt, .cpu .big small {
  color: inherit;
  opacity: .75;
}

@media (max-width: 1320px) {
  .k {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1100px) {
  .a, .c {
    grid-template-columns: 1fr;
  }
  .col {
    grid-template-rows: auto auto;
    height: auto;
  }
}

@media (max-width: 560px) {
  .ch.w {
    flex-wrap: wrap;
  }
  .ch.w .seg {
    order: 3;
    width: 100%;
  }
  .k {
    grid-template-columns: 1fr;
  }
  .leg {
    grid-template-columns: repeat(2, 1fr);
  }
  .chip {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
