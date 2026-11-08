<template>
  <div class="relative w-full h-full bg-black rounded-lg overflow-hidden flex items-center justify-center group" ref="wrapperRef">
    <!-- Main Video Element -->
    <video
      ref="videoRef"
      :class="videoClasses"
      :style="videoStyle"
      autoplay
      muted
      playsinline
    ></video>

    <!-- Bounding Box AI Overlay Layer -->
    <BboxOverlay
      :video-element="videoRef"
      :boxes="boxes"
      :last-updated="lastUpdated"
      :is-hls="isHlsMode"
      :split-count="splitCount"
      :slice-index="sliceIndex"
    />

    <!-- Header Badges -->
    <div class="absolute top-2 left-2 flex items-center space-x-2 pointer-events-none">
      <Badge :variant="isPlaying ? 'success' : 'secondary'">
        {{ isPlaying ? $t('matrix.liveBadge') : $t('common.status') }}
      </Badge>
      <Badge :variant="isHlsMode ? 'warning' : 'default'">
        {{ isHlsMode ? $t('matrix.hlsFallback') : $t('matrix.webrtc') }}
      </Badge>
      <Badge v-if="splitCount && splitCount > 1" variant="secondary" class="font-mono text-[10px] bg-black/80 text-cyan-300 border border-cyan-500/30">
        {{ `Sensor ${sliceIndex + 1}/${splitCount}` }}
      </Badge>
    </div>

    <!-- Error / Loading Overlay -->
    <div
      v-if="isLoading || errorMessage"
      class="absolute inset-0 bg-black/60 flex flex-col items-center justify-center p-4 text-center z-10"
    >
      <div v-if="isLoading" class="flex flex-col items-center space-y-2">
        <span class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
        <span class="text-xs text-zinc-300 font-medium">{{ $t('matrix.reconnecting') }}</span>
      </div>
      <div v-else-if="errorMessage" class="flex flex-col items-center space-y-2">
        <span class="text-xs text-red-400 font-medium">{{ errorMessage }}</span>
        <Button variant="outline" size="sm" @click="initStream">
          {{ $t('common.retry') }}
        </Button>
      </div>
    </div>

    <!-- Hover Controls (Fullscreen, Stream Switch) -->
    <div class="absolute bottom-2 right-2 flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20">
      <button
        type="button"
        @click="toggleFullscreen"
        class="p-1.5 rounded-md bg-black/70 hover:bg-black text-white/90 hover:text-white transition-colors cursor-pointer"
        :title="$t('matrix.fullscreen')"
        :aria-label="$t('matrix.fullscreen')"
      >
        <Maximize2 class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import type HlsType from "hls.js";
import { Maximize2 } from "lucide-vue-next";
import Badge from "./ui/Badge.vue";
import Button from "./ui/Button.vue";
import BboxOverlay from "./BboxOverlay.vue";
import type { DetectionBox } from "../stores/socket.js";
import { useAuthStore } from "../stores/auth.js";

const props = withDefaults(
  defineProps<{
    streamPath: string; // e.g. "cam1"
    boxes?: DetectionBox[];
    lastUpdated?: number;
    forceHls?: boolean;
    splitCount?: number; // 1 to 4
    sliceIndex?: number; // 0 to splitCount - 1
  }>(),
  {
    splitCount: 1,
    sliceIndex: 0,
  }
);

const isSplit = computed(() => (props.splitCount || 1) > 1);

const videoClasses = computed(() => {
  return isSplit.value
    ? "pointer-events-none select-none max-w-none transition-all duration-300"
    : "w-full h-full object-contain";
});

const videoStyle = computed(() => {
  if (!isSplit.value) return {};
  const count = props.splitCount || 1;
  const idx = props.sliceIndex || 0;
  return {
    position: "absolute" as const,
    width: "100%",
    height: `${count * 100}%`,
    top: `-${idx * 100}%`,
    left: "0",
    objectFit: "fill" as const,
  };
});

const authStore = useAuthStore();
const videoRef = ref<HTMLVideoElement | null>(null);
const wrapperRef = ref<HTMLDivElement | null>(null);
const isPlaying = ref<boolean>(false);
const isLoading = ref<boolean>(true);
const isHlsMode = ref<boolean>(false);
const errorMessage = ref<string | null>(null);

let pc: RTCPeerConnection | null = null;
let hls: HlsType | null = null;
let HlsLib: typeof import("hls.js").default | null = null;
let whepWatchdog: ReturnType<typeof setTimeout> | null = null;

const clearWatchdog = () => {
  if (whepWatchdog) {
    clearTimeout(whepWatchdog);
    whepWatchdog = null;
  }
};

const stopAll = () => {
  clearWatchdog();
  if (pc) {
    pc.close();
    pc = null;
  }
  if (hls) {
    hls.destroy();
    hls = null;
  }
  if (videoRef.value) {
    videoRef.value.srcObject = null;
    videoRef.value.removeAttribute("src");
    videoRef.value.load();
  }
  isPlaying.value = false;
};

// Start HLS Stream Fallback (Ultra-low-latency configuration)
const startHls = async (path: string) => {
  stopAll();
  isHlsMode.value = true;
  isLoading.value = true;
  errorMessage.value = null;

  // Use same-origin proxy to eliminate CORS, port, and relative redirect issues
  const tokenParam = authStore.token ? `?jwt=${encodeURIComponent(authStore.token)}` : "";
  const hlsUrl = `/stream/hls/${path}/index.m3u8${tokenParam}`;

  if (!videoRef.value) return;

  const v = videoRef.value;
  v.onloadedmetadata = () => {
    v.play().catch(() => {});
  };
  v.onplaying = () => {
    isLoading.value = false;
    isPlaying.value = true;
  };

  // Load hls.js only when the HLS fallback is needed, keeping it out of the
  // initial bundle (and off the login page).
  if (!HlsLib) {
    try {
      const mod = await import("hls.js");
      HlsLib = mod.default;
    } catch {
      isLoading.value = false;
      errorMessage.value = "HLS Not Supported in this browser";
      return;
    }
  }
  // The component may have unmounted or switched streams while resolving.
  if (!videoRef.value || videoRef.value !== v) return;

  const Hls = HlsLib!;
  if (Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      liveSyncDurationCount: 1,
      liveMaxLatencyDurationCount: 2,
      maxBufferLength: 1,
      maxMaxBufferLength: 2,
      backBufferLength: 0,
      highBufferWatchdogPeriod: 1,
      liveDurationInfinity: true,
    });
    hls.loadSource(hlsUrl);
    hls.attachMedia(v);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      v.play().catch(() => {});
    });

    // Pinned to live edge: if video lags behind buffer edge by > 1.8s, jump to latest frame
    hls.on(Hls.Events.LEVEL_UPDATED, () => {
      if (v && v.buffered.length > 0) {
        const liveEdge = v.buffered.end(v.buffered.length - 1);
        const lag = liveEdge - v.currentTime;
        if (lag > 1.8) {
          v.currentTime = Math.max(0, liveEdge - 0.2);
        }
      }
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        console.warn("[HLS Error]", data);
        isLoading.value = false;
        errorMessage.value = "HLS Stream Error";
      }
    });
  } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
    v.src = hlsUrl;
    v.addEventListener("loadedmetadata", () => {
      v.play().catch(() => {});
    });
  } else {
    isLoading.value = false;
    errorMessage.value = "HLS Not Supported in this browser";
  }
};

// Start WebRTC (WHEP) Stream
const startWhep = async (path: string) => {
  stopAll();
  isHlsMode.value = false;
  isLoading.value = true;
  errorMessage.value = null;

  if (props.forceHls) {
    startHls(path);
    return;
  }

  try {
    pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.oniceconnectionstatechange = () => {
      if (pc?.iceConnectionState === "failed" || pc?.iceConnectionState === "disconnected") {
        console.warn("[WebRTC ICE State]:", pc?.iceConnectionState, "-> Falling back to HLS");
        clearWatchdog();
        startHls(path);
      }
    };

    pc.ontrack = (event) => {
      if (videoRef.value && event.streams[0]) {
        videoRef.value.srcObject = event.streams[0];
        videoRef.value.play().catch(() => {});
        videoRef.value.onplaying = () => {
          clearWatchdog();
          isPlaying.value = true;
          isLoading.value = false;
        };
        videoRef.value.onloadeddata = () => {
          clearWatchdog();
          isPlaying.value = true;
          isLoading.value = false;
        };
        videoRef.value.ontimeupdate = () => {
          if (videoRef.value && videoRef.value.currentTime > 0) {
            clearWatchdog();
            isPlaying.value = true;
            isLoading.value = false;
          }
        };
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const tokenParam = authStore.token ? `?jwt=${encodeURIComponent(authStore.token)}` : "";
    const whepUrl = `/stream/webrtc/${path}/whep${tokenParam}`;
    const res = await fetch(whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp,
    });

    if (!res.ok) {
      throw new Error(`WHEP endpoint returned status ${res.status}`);
    }

    const answerSdp = await res.text();
    if (pc) {
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    }

    // Watchdog: Give WebRTC up to 5.0s to receive first frame before fallback (handles GOP intervals)
    whepWatchdog = setTimeout(() => {
      if (!videoRef.value || videoRef.value.videoWidth === 0 || !isPlaying.value) {
        console.warn("[WebRTC Watchdog] No video frames received after 5s -> switching to HLS");
        startHls(path);
      }
    }, 5000);

  } catch (err) {
    console.warn("[WebRTC WHEP Failed] Falling back to HLS stream:", err);
    clearWatchdog();
    startHls(path);
  }
};

const initStream = () => {
  if (!props.streamPath) return;
  if (props.forceHls) {
    startHls(props.streamPath);
  } else {
    startWhep(props.streamPath);
  }
};

const toggleFullscreen = () => {
  if (!wrapperRef.value) return;
  if (!document.fullscreenElement) {
    wrapperRef.value.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
};

watch(() => props.streamPath, () => initStream());
watch(() => props.forceHls, () => initStream());

onMounted(() => {
  initStream();
});

onUnmounted(() => {
  stopAll();
});
</script>

