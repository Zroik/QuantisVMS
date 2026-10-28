<template>
  <div class="absolute inset-0 pointer-events-none overflow-hidden" ref="containerRef">
    <!-- HLS Disabled Notification Badge -->
    <div v-if="isHls" class="absolute bottom-2 left-2 pointer-events-auto">
      <Badge variant="warning">{{ $t('matrix.hlsOverlayDisabled') }}</Badge>
    </div>

    <!-- SVG Layer for Bounding Boxes -->
    <svg
      v-else-if="videoRect.width > 0 && videoRect.height > 0"
      class="absolute inset-0 w-full h-full"
      :viewBox="`0 0 ${containerWidth} ${containerHeight}`"
    >
      <g v-for="(box, idx) in visibleBoxes" :key="idx">
        <!-- Bounding Box Rectangle (rx 4, stroke 1.5px, fill rgba(0,122,255,0.08)) -->
        <rect
          :x="box.x"
          :y="box.y"
          :width="box.w"
          :height="box.h"
          rx="4"
          ry="4"
          fill="rgba(0,122,255,0.08)"
          stroke="#007AFF"
          stroke-width="1.5"
        />

        <!-- Label Pill Background -->
        <rect
          :x="box.x"
          :y="Math.max(0, box.y - 18)"
          :width="box.labelWidth"
          height="18"
          rx="3"
          ry="3"
          fill="#007AFF"
        />

        <!-- Label Pill Text (10px medium tabular-nums) -->
        <text
          :x="box.x + 4"
          :y="Math.max(0, box.y - 18) + 12"
          fill="#FFFFFF"
          font-size="10"
          font-weight="500"
          class="tabular-nums font-mono select-none"
        >
          {{ box.label }}
        </text>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import Badge from "./ui/Badge.vue";
import type { DetectionBox } from "../stores/socket.js";

const props = withDefaults(
  defineProps<{
    boxes?: DetectionBox[];
    lastUpdated?: number;
    isHls?: boolean;
    videoElement?: HTMLVideoElement | null;
  }>(),
  {
    boxes: () => [],
    lastUpdated: 0,
    isHls: false,
    videoElement: null,
  }
);

const containerRef = ref<HTMLDivElement | null>(null);
const containerWidth = ref<number>(640);
const containerHeight = ref<number>(360);
const now = ref<number>(Date.now());
let timer: number | null = null;

// Track container dimensions with ResizeObserver
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (containerRef.value) {
    containerWidth.value = containerRef.value.clientWidth || 640;
    containerHeight.value = containerRef.value.clientHeight || 360;

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          containerWidth.value = entry.contentRect.width;
          containerHeight.value = entry.contentRect.height;
        }
      });
      resizeObserver.observe(containerRef.value);
    }
  }

  // Periodic tick for hiding boxes older than 1000ms
  timer = window.setInterval(() => {
    now.value = Date.now();
  }, 200);
});

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect();
  if (timer) clearInterval(timer);
});

// Compute actual rendered video rectangle inside container (letterbox / pillarbox handling)
const videoRect = computed(() => {
  const cw = containerWidth.value;
  const ch = containerHeight.value;
  if (!cw || !ch) return { x: 0, y: 0, width: 0, height: 0 };

  const vw = props.videoElement?.videoWidth || 1920;
  const vh = props.videoElement?.videoHeight || 1080;

  const containerRatio = cw / ch;
  const videoRatio = vw / vh;

  let renderW = cw;
  let renderH = ch;
  let offsetX = 0;
  let offsetY = 0;

  if (containerRatio > videoRatio) {
    // Pillarboxed (black bars left and right)
    renderW = ch * videoRatio;
    renderH = ch;
    offsetX = (cw - renderW) / 2;
  } else {
    // Letterboxed (black bars top and bottom)
    renderW = cw;
    renderH = cw / videoRatio;
    offsetY = (ch - renderH) / 2;
  }

  return {
    x: offsetX,
    y: offsetY,
    width: renderW,
    height: renderH,
  };
});

// Filter boxes older than 1000ms and compute mapped coordinates
const visibleBoxes = computed(() => {
  if (props.isHls) return [];
  const age = now.value - (props.lastUpdated || 0);
  if (age > 1000) return []; // Expire after 1000ms

  const rect = videoRect.value;
  if (rect.width <= 0 || rect.height <= 0) return [];

  return (props.boxes || []).map((b) => {
    // b.bbox is [x1, y1, x2, y2] normalized to [0.0, 1.0]
    let [x1, y1, x2, y2] = b.bbox;

    // Guard coordinate order if inverted
    if (x1 > x2) [x1, x2] = [x2, x1];
    if (y1 > y2) [y1, y2] = [y2, y1];

    const mappedX = rect.x + x1 * rect.width;
    const mappedY = rect.y + y1 * rect.height;
    const mappedW = (x2 - x1) * rect.width;
    const mappedH = (y2 - y1) * rect.height;

    const confPct = Math.round((b.confidence || 0) * 100);
    const label = `${b.class_name} ${confPct}%`;
    const labelWidth = Math.max(50, label.length * 6.5 + 8);

    return {
      x: Math.max(0, mappedX),
      y: Math.max(0, mappedY),
      w: Math.max(10, mappedW),
      h: Math.max(10, mappedH),
      label,
      labelWidth,
    };
  });
});
</script>
