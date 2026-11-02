<template>
  <div class="matrix-view app">
    <!-- Breadcrumb -->
    <p class="crumb">
      Quantis
      <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
      <b>Matriks Kamera</b>
    </p>

    <!-- Header Section -->
    <div class="hd">
      <h1>Matriks kamera</h1>
      <div class="chip" aria-live="off">
        <i class="dot pulse"></i>
        <b class="mono">{{ camerasStore.cameras.length }} Kamera</b>
        <hr />
        <div>
          <b>WebRTC WHEP</b>
          <small>Ultra low-latency streaming</small>
        </div>
      </div>
    </div>

    <!-- Controls: Grid Selector & AI Class Toggle -->
    <div class="card rv" style="--i:0; margin-bottom: 16px; padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--mu);">Tata Letak Grid</span>
        <div class="seg" role="group" aria-label="Pilih Grid">
          <button
            type="button"
            v-for="cols in [1, 2, 3, 4]"
            :key="cols"
            @click="gridCols = cols"
            :aria-pressed="gridCols === cols"
            class="mono"
          >
            {{ cols }}×{{ cols }}
          </button>
        </div>
      </div>

      <button
        type="button"
        @click="showTogglePanel = !showTogglePanel"
        class="btn o s"
        :class="{ active: showTogglePanel }"
        title="Filter deteksi objek YOLO26n"
      >
        <svg viewBox="0 0 24 24">
          <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        <span>Filter AI YOLO26n</span>
      </button>
    </div>

    <!-- Main Content: Matrix Grid + Optional Right Class Panel -->
    <div class="matrix-layout" :class="{ 'with-panel': showTogglePanel && activeCamera }">
      <!-- Camera Stream Tiles -->
      <div class="stream-area">
        <!-- Loading Skeletons -->
        <div v-if="camerasStore.isLoading" class="grid-streams" :class="gridClasses">
          <Skeleton v-for="i in 4" :key="i" class="aspect-video w-full rounded-2xl" />
        </div>

        <!-- Empty State -->
        <div v-else-if="camerasStore.cameras.length === 0" class="card empty-card">
          <CameraIcon class="h-10 w-10 mx-auto text-zinc-400 mb-3" />
          <p class="text-sm font-medium" style="color:var(--muted)">Belum ada kamera IP terdaftar dalam sistem.</p>
          <router-link :to="{ name: 'settings' }" class="inline-block mt-4">
            <button class="btn" style="background:var(--accent);color:#fff">Tambah Kamera</button>
          </router-link>
        </div>

        <!-- Camera Tiles Grid -->
        <div v-else class="grid-streams" :class="gridClasses">
          <div
            v-for="camera in camerasStore.cameras"
            :key="camera.id"
            @click="selectCamera(camera.id)"
            class="cam-tile"
            :class="{ selected: activeCamera?.id === camera.id }"
          >
            <!-- Camera Tile Header -->
            <div class="cam-header">
              <div class="cam-title">
                <span class="cam-name">{{ camera.name }}</span>
                <span class="mono ip">{{ camera.rtsp_host }}</span>
              </div>
              <div style="display:flex; align-items:center; gap:6px">
                <button
                  v-if="camera.onvif_xaddr"
                  type="button"
                  class="ptz-pill-btn"
                  @click.stop="openOnvifPanel(camera.id)"
                  title="Buka Kontrol PTZ & Citra ONVIF"
                >
                  <svg class="w-3 h-3 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="3" stroke-width="2" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
                  </svg>
                  <span class="mono" style="font-size:10px">ONVIF</span>
                </button>
                <span v-if="camera.enabled" class="ok">Live</span>
                <span v-else class="offline-pill mono">Offline</span>
              </div>
            </div>

            <!-- Video Player Aspect Container -->
            <div class="video-container">
              <VideoPlayer
                :stream-path="camera.stream_path || `cam${camera.parent_camera_id || camera.id}`"
                :split-count="camera.split_count || 1"
                :slice-index="camera.slice_index || 0"
                :boxes="socketStore.cameraDetections[camera.id]?.boxes || socketStore.cameraDetections[camera.parent_camera_id || 0]?.boxes || []"
                :last-updated="socketStore.cameraDetections[camera.id]?.timestamp || socketStore.cameraDetections[camera.parent_camera_id || 0]?.timestamp"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Right Side Panel (AI YOLO or ONVIF Controls) -->
      <div v-if="showTogglePanel && activeCamera" class="ai-panel">
        <article class="card">
          <div class="panel-head">
            <div>
              <span class="eyebrow">Target Kamera #{{ activeCamera.id }}</span>
              <h2>{{ activeCamera.name }}</h2>
            </div>
            <button
              type="button"
              @click="showTogglePanel = false"
              aria-label="Tutup"
              class="close-btn"
            >
              ✕
            </button>
          </div>

          <!-- Tab Bar: YOLO AI vs ONVIF Controls -->
          <div class="panel-tabs">
            <button
              type="button"
              class="tab-btn"
              :class="{ active: panelTab === 'yolo' }"
              @click="panelTab = 'yolo'"
            >
              <svg class="w-3.5 h-3.5 inline mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2" />
                <path d="M9 9h6v6H9z" stroke-width="2" />
              </svg>
              Deteksi AI (YOLO)
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ active: panelTab === 'onvif' }"
              @click="panelTab = 'onvif'"
            >
              <svg class="w-3.5 h-3.5 inline mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="4" stroke-width="2" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2v4m0 12v4M2 12h4m12 0h4" />
              </svg>
              Kontrol Kamera (ONVIF)
            </button>
          </div>

          <div v-if="panelTab === 'yolo'" class="pt-1">
            <ClassTogglePanel
              :camera-id="activeCamera.id"
              :initial-classes="activeCamera.active_yolo_classes"
              :initial-confidence="activeCamera.confidence_threshold"
            />
          </div>

          <div v-else class="pt-1">
            <CameraControlPanel
              :camera-id="activeCamera.id"
            />
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { Camera as CameraIcon } from "lucide-vue-next";
import Skeleton from "../components/ui/Skeleton.vue";
import VideoPlayer from "../components/VideoPlayer.vue";
import ClassTogglePanel from "../components/ClassTogglePanel.vue";
import CameraControlPanel from "../components/CameraControlPanel.vue";
import { useCamerasStore } from "../stores/cameras.js";
import { useSocketStore } from "../stores/socket.js";

const camerasStore = useCamerasStore();
const socketStore = useSocketStore();

const gridCols = ref<number>(2);
const showTogglePanel = ref<boolean>(false);
const panelTab = ref<"yolo" | "onvif">("yolo");

const openOnvifPanel = (camId: number) => {
  camerasStore.activeCameraId = camId;
  panelTab.value = "onvif";
  showTogglePanel.value = true;
};

const gridClasses = computed(() => {
  switch (gridCols.value) {
    case 1:
      return "cols-1";
    case 3:
      return "cols-3";
    case 4:
      return "cols-4";
    case 2:
    default:
      return "cols-2";
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
  if (camerasStore.cameras.length === 3) {
    gridCols.value = 3;
  }
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

<style scoped>
.matrix-view {
  min-width: 0;
  width: 100%;
  padding: 24px clamp(16px, 2vw, 32px) 48px;
}

.grid-picker {
  display: flex;
  background: var(--surface);
  border-radius: 10px;
  box-shadow: var(--ring);
  padding: 2px;
  gap: 2px;
}

.grid-btn {
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  transition: all .15s;
}

.grid-btn:hover {
  color: var(--text);
  background: var(--surface-2);
}

.grid-btn.active {
  color: #FFFFFF;
  background: var(--accent);
}

.filter-btn {
  box-shadow: var(--ring);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  height: 32px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 10px;
}

.filter-btn.active {
  background: var(--accent);
  color: #FFFFFF;
}

.matrix-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  align-items: start;
}

.matrix-layout.with-panel {
  grid-template-columns: 8fr 4fr;
}

@media (max-width: 1024px) {
  .matrix-layout.with-panel {
    grid-template-columns: 1fr;
  }
}

.grid-streams {
  display: grid;
  gap: 16px;
}

.grid-streams.cols-1 { grid-template-columns: 1fr; }
.grid-streams.cols-2 { grid-template-columns: repeat(2, 1fr); }
.grid-streams.cols-3 { grid-template-columns: repeat(3, 1fr); }
.grid-streams.cols-4 { grid-template-columns: repeat(4, 1fr); }

@media (max-width: 768px) {
  .grid-streams.cols-2, .grid-streams.cols-3, .grid-streams.cols-4 {
    grid-template-columns: 1fr;
  }
}

.cam-tile {
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--ring);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: transform .15s, box-shadow .15s;
  cursor: pointer;
}

.cam-tile.selected {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.cam-header {
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 0 var(--hair);
  background: var(--surface);
}

.cam-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
}

.cam-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
}

.cam-header .ip {
  font-size: 11px;
  color: var(--faint);
}

.offline-pill {
  font-size: 11px;
  color: var(--muted);
  background: var(--surface-2);
  padding: 2px 8px;
  border-radius: 999px;
}

.video-container {
  aspect-ratio: 16 / 9;
  width: 100%;
  background: #000000;
  position: relative;
}

.empty-card {
  padding: 48px;
  text-align: center;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 12px;
  margin-bottom: 14px;
  box-shadow: 0 1px 0 var(--hair);
}

.close-btn {
  font-size: 14px;
  color: var(--muted);
  padding: 4px;
  border-radius: 6px;
}

.close-btn:hover {
  color: var(--text);
  background: var(--surface-2);
}

.ptz-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 9999px;
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.3);
  color: #818cf8;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ptz-pill-btn:hover {
  background: rgba(99, 102, 241, 0.28);
  border-color: rgba(99, 102, 241, 0.5);
  color: #a5b4fc;
}

.panel-tabs {
  display: flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 3px;
  gap: 4px;
  margin-bottom: 14px;
}

.tab-btn {
  flex: 1;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 7px;
  color: var(--muted);
  border: none;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab-btn:hover {
  color: var(--text);
}

.tab-btn.active {
  background: var(--surface-2, rgba(255, 255, 255, 0.08));
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
</style>
