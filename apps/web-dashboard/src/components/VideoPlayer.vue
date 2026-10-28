<template>
  <div class="relative w-full h-full bg-black rounded-lg overflow-hidden flex items-center justify-center group" ref="wrapperRef">
    <!-- Main Video Element -->
    <video
      ref="videoRef"
      class="w-full h-full object-contain"
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
    />

    <!-- Header Badges -->
    <div class="absolute top-2 left-2 flex items-center space-x-2 pointer-events-none">
      <Badge :variant="isPlaying ? 'success' : 'secondary'">
        {{ isPlaying ? $t('matrix.liveBadge') : $t('common.status') }}
      </Badge>
      <Badge :variant="isHlsMode ? 'warning' : 'default'">
        {{ isHlsMode ? $t('matrix.hlsFallback') : $t('matrix.webrtc') }}
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
import { ref, onMounted, onUnmounted, watch } from "vue";
import Hls from "hls.js";
import { Maximize2 } from "lucide-vue-next";
import Badge from "./ui/Badge.vue";
import Button from "./ui/Button.vue";
import BboxOverlay from "./BboxOverlay.vue";
import type { DetectionBox } from "../stores/socket.js";

const props = defineProps<{
  streamPath: string; // e.g. "cam1"
  boxes?: DetectionBox[];
  lastUpdated?: number;
  forceHls?: boolean;
}>();

const videoRef = ref<HTMLVideoElement | null>(null);
const wrapperRef = ref<HTMLDivElement | null>(null);
const isPlaying = ref<boolean>(false);
const isLoading = ref<boolean>(true);
const isHlsMode = ref<boolean>(false);
const errorMessage = ref<string | null>(null);

let pc: RTCPeerConnection | null = null;
let hls: Hls | null = null;

const stopAll = () => {
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

// Start HLS Stream Fallback
const startHls = (path: string) => {
  stopAll();
  isHlsMode.value = true;
  isLoading.value = true;
  errorMessage.value = null;

  // MediaMTX HLS URL format
  const hlsUrl = `http://${window.location.hostname}:8888/${path}/index.m3u8`;

  if (!videoRef.value) return;

  if (Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
    });
    hls.loadSource(hlsUrl);
    hls.attachMedia(videoRef.value);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      isLoading.value = false;
      videoRef.value?.play().catch(() => {});
      isPlaying.value = true;
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        isLoading.value = false;
        errorMessage.value = "HLS Stream Error";
      }
    });
  } else if (videoRef.value.canPlayType("application/vnd.apple.mpegurl")) {
    videoRef.value.src = hlsUrl;
    videoRef.value.addEventListener("loadedmetadata", () => {
      isLoading.value = false;
      videoRef.value?.play().catch(() => {});
      isPlaying.value = true;
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

    pc.ontrack = (event) => {
      if (videoRef.value && event.streams[0]) {
        videoRef.value.srcObject = event.streams[0];
        videoRef.value.play().catch(() => {});
        isPlaying.value = true;
        isLoading.value = false;
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const whepUrl = `http://${window.location.hostname}:8889/${path}/whep`;
    const res = await fetch(whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp,
    });

    if (!res.ok) {
      throw new Error(`WHEP endpoint returned status ${res.status}`);
    }

    const answerSdp = await res.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  } catch (err) {
    console.warn("[WebRTC WHEP Failed] Falling back to HLS stream:", err);
    // Graceful fallback to HLS
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

