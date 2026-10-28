<template>
  <div class="flex flex-col space-y-4">
    <!-- View Toolbar -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-200/80 dark:border-zinc-800/80">
      <div>
        <h2 class="text-lg sm:text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {{ $t('matrix.title') }}
        </h2>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          {{ camerasStore.cameras.length }} {{ $t('matrix.allCameras') }}
        </p>
      </div>

      <!-- Controls: Grid Columns & Panel Toggle -->
      <div class="flex items-center space-x-2">
        <div class="flex items-center rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#1C1C1E] p-0.5 text-xs shadow-xs">
          <button
            type="button"
            v-for="cols in [1, 2, 3, 4]"
            :key="cols"
            @click="gridCols = cols"
            :class="[
              'px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer tabular-nums',
              gridCols === cols
                ? 'bg-[#007AFF] text-white shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100',
            ]"
          >
            {{ cols }}x{{ cols }}
          </button>
        </div>

        <Button
          variant="outline"
          size="sm"
          @click="showTogglePanel = !showTogglePanel"
          :class="showTogglePanel ? 'border-[#007AFF] text-[#007AFF]' : ''"
        >
          <SlidersHorizontal class="h-3.5 w-3.5 mr-1.5" />
          {{ $t('toggle.title') }}
        </Button>
      </div>
    </div>

    <!-- Main Content: Matrix Grid + Optional Right Class Panel -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      <!-- Matrix Stream Grid -->
      <div :class="[showTogglePanel && activeCamera ? 'lg:col-span-8' : 'lg:col-span-12']">
        <!-- Loading Skeletons -->
        <div v-if="camerasStore.isLoading" class="grid gap-4" :class="gridClasses">
          <Skeleton v-for="i in 4" :key="i" class="aspect-video w-full rounded-xl" />
        </div>

        <!-- Empty State -->
        <div
          v-else-if="camerasStore.cameras.length === 0"
          class="p-12 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#1C1C1E] text-center"
        >
          <CameraIcon class="h-10 w-10 mx-auto text-zinc-400 mb-3" />
          <p class="text-sm text-zinc-500 font-medium">{{ $t('matrix.noCameras') }}</p>
          <router-link :to="{ name: 'settings' }" class="inline-block mt-4">
            <Button size="sm">{{ $t('settings.addCamera') }}</Button>
          </router-link>
        </div>

        <!-- Camera Tiles Grid -->
        <div v-else class="grid gap-4" :class="gridClasses">
          <div
            v-for="camera in camerasStore.cameras"
            :key="camera.id"
            @click="selectCamera(camera.id)"
            class="relative flex flex-col rounded-xl overflow-hidden border transition-all cursor-pointer shadow-xs group"
            :class="[
              activeCamera?.id === camera.id
                ? 'border-[#007AFF] ring-2 ring-[#007AFF]/30'
                : 'border-zinc-200/80 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700',
            ]"
          >
            <!-- Camera Tile Header -->
            <div class="px-3 py-2 bg-white dark:bg-[#1C1C1E] border-b border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between text-xs">
              <div class="flex items-center space-x-2 truncate">
                <span class="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{{ camera.name }}</span>
                <span class="text-zinc-400 font-mono text-[10px]">{{ camera.rtsp_host }}</span>
              </div>
              <Badge :variant="camera.enabled ? 'success' : 'secondary'">
                {{ camera.enabled ? $t('matrix.online') : $t('matrix.offline') }}
              </Badge>
            </div>

            <!-- Video Player Aspect Container -->
            <div class="aspect-video w-full bg-black relative">
              <VideoPlayer
                :stream-path="`cam${camera.id}`"
                :boxes="socketStore.cameraDetections[camera.id]?.boxes || []"
                :last-updated="socketStore.cameraDetections[camera.id]?.timestamp"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Right Side Class Toggle Panel -->
      <div v-if="showTogglePanel && activeCamera" class="lg:col-span-4 sticky top-20">
        <Card class="p-4">
          <div class="flex items-center justify-between pb-3 mb-3 border-b border-zinc-200/80 dark:border-zinc-800/80">
            <div>
              <span class="text-xs font-semibold uppercase text-zinc-400">{{ $t('matrix.targetCamera') }}</span>
              <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100">{{ activeCamera.name }}</h3>
            </div>
            <button
              type="button"
              @click="showTogglePanel = false"
              :aria-label="$t('common.close')"
              class="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              ✕
            </button>
          </div>

          <ClassTogglePanel
            :camera-id="activeCamera.id"
            :initial-classes="activeCamera.active_yolo_classes"
            :initial-confidence="activeCamera.confidence_threshold"
          />
        </Card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { SlidersHorizontal, Camera as CameraIcon } from "lucide-vue-next";
import Button from "../components/ui/Button.vue";
import Badge from "../components/ui/Badge.vue";
import Card from "../components/ui/Card.vue";
import Skeleton from "../components/ui/Skeleton.vue";
import VideoPlayer from "../components/VideoPlayer.vue";
import ClassTogglePanel from "../components/ClassTogglePanel.vue";
import { useCamerasStore } from "../stores/cameras.js";
import { useSocketStore } from "../stores/socket.js";

const camerasStore = useCamerasStore();
const socketStore = useSocketStore();

const gridCols = ref<number>(2);
const showTogglePanel = ref<boolean>(false);

const gridClasses = computed(() => {
  switch (gridCols.value) {
    case 1:
      return "grid-cols-1";
    case 3:
      return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    case 4:
      return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
    case 2:
    default:
      return "grid-cols-1 sm:grid-cols-2";
  }
});

const activeCamera = computed(() => {
  return camerasStore.cameras.find((c) => c.id === camerasStore.activeCameraId) || camerasStore.cameras[0];
});

const selectCamera = (id: number) => {
  camerasStore.activeCameraId = id;
};

onMounted(async () => {
  await camerasStore.fetchCameras();
  // Join socket rooms for all enabled cameras to receive real-time YOLO bounding boxes
  for (const cam of camerasStore.cameras) {
    socketStore.joinCameraRoom(cam.id);
  }
});

onUnmounted(() => {
  for (const cam of camerasStore.cameras) {
    socketStore.leaveCameraRoom(cam.id);
  }
});
</script>
