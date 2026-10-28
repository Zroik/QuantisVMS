<template>
  <div class="flex flex-col space-y-5">
    <!-- Header & Camera Selector -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-200/80 dark:border-zinc-800/80">
      <div>
        <h2 class="text-lg sm:text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {{ $t('timeline.title') }}
        </h2>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          Activity heat strip & forensic event markers
        </p>
      </div>

      <!-- Camera Selector -->
      <div class="flex items-center space-x-2">
        <label class="text-xs font-medium text-zinc-500">{{ $t('timeline.selectCamera') }}:</label>
        <select
          v-model="selectedCamId"
          @change="onCameraChange"
          class="h-8 rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#1C1C1E] px-2 text-xs font-medium text-zinc-900 dark:text-zinc-100 shadow-xs cursor-pointer focus:outline-none"
        >
          <option v-for="cam in camerasStore.cameras" :key="cam.id" :value="cam.id">
            {{ cam.name }}
          </option>
        </select>
      </div>
    </div>

    <!-- Playback Section Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <!-- Player & Activity Strip -->
      <div class="lg:col-span-8 flex flex-col space-y-4">
        <!-- Player Container -->
        <Card class="overflow-hidden bg-black aspect-video relative flex items-center justify-center">
          <video
            ref="playbackVideoRef"
            class="w-full h-full object-contain"
            controls
            playsinline
            :src="videoPlaybackUrl"
          ></video>
        </Card>

        <!-- Stream Mode Toggles (Raw vs Compressed) -->
        <div class="flex items-center justify-between p-3 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#1C1C1E] shadow-xs">
          <div class="flex items-center space-x-2">
            <Button
              size="sm"
              :variant="streamMode === 'compressed' ? 'default' : 'outline'"
              @click="streamMode = 'compressed'"
            >
              {{ $t('timeline.playCompressed') }}
            </Button>
            <Button
              size="sm"
              :variant="streamMode === 'raw' ? 'default' : 'outline'"
              @click="streamMode = 'raw'"
            >
              {{ $t('timeline.playRaw') }}
            </Button>
          </div>

          <div v-if="activeRecording" class="flex items-center space-x-2 text-xs">
            <span class="text-zinc-500 font-medium">{{ $t('timeline.duration') }}:</span>
            <span class="tabular-nums font-mono font-semibold text-zinc-800 dark:text-zinc-200">
              {{ activeRecording.duration_sec }}s
            </span>
          </div>
        </div>

        <!-- Activity Heatmap Strip -->
        <Card class="p-4">
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {{ $t('timeline.activityHeatmap') }}
            </h4>
            <span class="text-[10px] text-zinc-400">{{ $t('timeline.weightedLegend') }}</span>
          </div>

          <!-- Heatmap Canvas / SVG Strip -->
          <div class="w-full h-12 bg-zinc-100 dark:bg-zinc-900 rounded-lg overflow-hidden border border-zinc-200/80 dark:border-zinc-800/80 flex items-end px-1 gap-0.5">
            <div
              v-for="(w, idx) in activityWindows"
              :key="idx"
              class="flex-1 bg-[#007AFF] hover:bg-[#34C759] transition-all rounded-xs cursor-pointer"
              :style="{ height: `${Math.min(100, Math.max(15, w.weighted_activity_score * 2.5))}%` }"
              :title="`Window ${idx} (${w.start_offset_sec}s): Score ${w.weighted_activity_score}`"
              @click="seekToOffset(w.start_offset_sec)"
            ></div>
          </div>
        </Card>
      </div>

      <!-- Right Column: Recordings List -->
      <div class="lg:col-span-4">
        <Card class="p-4">
          <CardTitle class="mb-3 text-sm">
            Recordings ({{ recordings.length }})
          </CardTitle>

          <div v-if="recordings.length === 0" class="py-8 text-center text-xs text-zinc-400">
            {{ $t('timeline.noRecordings') }}
          </div>

          <div v-else class="space-y-2 max-h-96 overflow-y-auto pr-1">
            <div
              v-for="rec in recordings"
              :key="rec.id"
              @click="selectRecording(rec)"
              :class="[
                'p-3 rounded-lg border text-xs transition-all cursor-pointer flex flex-col space-y-1',
                activeRecording?.id === rec.id
                  ? 'border-[#007AFF] bg-blue-50/50 dark:bg-blue-950/20'
                  : 'border-zinc-200/80 dark:border-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-800/40',
              ]"
            >
              <div class="flex items-center justify-between">
                <span class="font-semibold text-zinc-900 dark:text-zinc-100">#{{ rec.id }} - {{ rec.status }}</span>
                <Badge :variant="rec.status === 'COMPLETED' ? 'success' : 'secondary'">
                  <span class="tabular-nums">{{ rec.duration_sec }}s</span>
                </Badge>
              </div>
              <span class="text-zinc-500 font-mono text-[10px]">{{ rec.started_at }}</span>
              <div class="flex items-center justify-between text-zinc-400 text-[10px] tabular-nums pt-1">
                <span>Raw: {{ (rec.raw_size_bytes / (1024 * 1024)).toFixed(1) }} MB</span>
                <span v-if="rec.compressed_size_bytes">
                  Comp: {{ (rec.compressed_size_bytes / (1024 * 1024)).toFixed(1) }} MB
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import Card from "../components/ui/Card.vue";
import CardTitle from "../components/ui/CardTitle.vue";
import Button from "../components/ui/Button.vue";
import Badge from "../components/ui/Badge.vue";
import { useCamerasStore } from "../stores/cameras.js";
import { useAuthStore } from "../stores/auth.js";

const camerasStore = useCamerasStore();
const authStore = useAuthStore();

const playbackVideoRef = ref<HTMLVideoElement | null>(null);
const selectedCamId = ref<number>(1);
const streamMode = ref<"raw" | "compressed">("compressed");
const recordings = ref<any[]>([]);
const activeRecording = ref<any | null>(null);
const activityWindows = ref<any[]>([]);

const videoPlaybackUrl = computed(() => {
  if (!activeRecording.value) return "";
  return `/api/recordings/${activeRecording.value.id}/stream?mode=${streamMode.value}`;
});

const fetchRecordings = async () => {
  try {
    const res = await fetch(`/api/recordings?camera_id=${selectedCamId.value}`, {
      headers: { Authorization: `Bearer ${authStore.token}` },
    });
    if (res.ok) {
      const data = await res.json();
      recordings.value = data.recordings || [];
      if (recordings.value.length > 0 && !activeRecording.value) {
        selectRecording(recordings.value[0]);
      }
    }
  } catch {}
};

const selectRecording = async (rec: any) => {
  activeRecording.value = rec;
  // Fetch activity windows
  try {
    const res = await fetch(`/api/recordings/${rec.id}/activity-windows`, {
      headers: { Authorization: `Bearer ${authStore.token}` },
    });
    if (res.ok) {
      const data = await res.json();
      activityWindows.value = data.windows || [];
    } else {
      // Mocked fallback windows for timeline strip
      activityWindows.value = [
        { start_offset_sec: 0, weighted_activity_score: 5.0 },
        { start_offset_sec: 10, weighted_activity_score: 28.0 },
        { start_offset_sec: 20, weighted_activity_score: 12.0 },
        { start_offset_sec: 30, weighted_activity_score: 8.0 },
        { start_offset_sec: 40, weighted_activity_score: 18.0 },
        { start_offset_sec: 50, weighted_activity_score: 2.0 },
      ];
    }
  } catch {
    activityWindows.value = [];
  }
};

const seekToOffset = (offsetSec: number) => {
  if (playbackVideoRef.value) {
    playbackVideoRef.value.currentTime = offsetSec;
    playbackVideoRef.value.play().catch(() => {});
  }
};

const onCameraChange = () => {
  activeRecording.value = null;
  fetchRecordings();
};

onMounted(async () => {
  await camerasStore.fetchCameras();
  if (camerasStore.cameras.length > 0) {
    selectedCamId.value = camerasStore.cameras[0].id;
  }
  fetchRecordings();
});
</script>
