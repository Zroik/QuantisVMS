<template>
  <div class="camera-control-panel">
    <!-- Loading State -->
    <div v-if="loading" class="p-6 text-center text-sm text-zinc-400">
      <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500 mb-2"></div>
      <p>Membaca kapabilitas ONVIF kamera...</p>
    </div>

    <!-- Unsupported / No ONVIF State -->
    <div v-else-if="!supported" class="p-6 text-center">
      <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800/60 flex items-center justify-center text-zinc-400">
        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </div>
      <h3 class="text-sm font-semibold text-zinc-200 mb-1">ONVIF Tidak Dikonfigurasi</h3>
      <p class="text-xs text-zinc-400 mb-4">
        Kamera ini streaming melalui RTSP langsung tanpa parameter kontrol ONVIF aktif. Anda dapat menghubungkan ONVIF di menu Konfigurasi.
      </p>
    </div>

    <!-- Active ONVIF Controls -->
    <div v-else class="space-y-4">
      <!-- Capability Badges Banner -->
      <div class="flex items-center justify-between p-3 rounded-xl bg-zinc-100/80 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 text-xs">
        <div class="flex items-center gap-2">
          <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span class="font-medium text-zinc-800 dark:text-zinc-200">ONVIF v2.x Aktif</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span v-if="hasPtz" class="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">PTZ</span>
          <span v-if="hasImaging" class="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">Imaging</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-200 dark:bg-zinc-700/40 text-zinc-700 dark:text-zinc-300">Profile S</span>
        </div>
      </div>

      <!-- SECTION 1: PTZ CONTROLLER (If Supported) -->
      <div v-if="hasPtz" class="p-4 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/80">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-indigo-500 dark:text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2v20m10-10H2" />
            </svg>
            <h4 class="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">Navigasi Pan / Tilt / Zoom</h4>
          </div>
          <span class="text-[10px] text-zinc-500 font-mono">Tahan tombol untuk gerak</span>
        </div>

        <div class="flex flex-col items-center gap-4 py-2">
          <!-- 3x3 PTZ Directional D-Pad -->
          <div class="ptz-grid">
            <!-- Top Left -->
            <button
              type="button"
              class="ptz-btn"
              @pointerdown="startPtz(-0.6, 0.6)"
              @pointerup="stopPtz"
              @pointerleave="stopPtz"
              title="Kiri Atas"
            >
              <svg class="w-4 h-4 -rotate-45" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
            </button>
            <!-- Up -->
            <button
              type="button"
              class="ptz-btn"
              @pointerdown="startPtz(0, 0.8)"
              @pointerup="stopPtz"
              @pointerleave="stopPtz"
              title="Atas"
            >
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
            </button>
            <!-- Top Right -->
            <button
              type="button"
              class="ptz-btn"
              @pointerdown="startPtz(0.6, 0.6)"
              @pointerup="stopPtz"
              @pointerleave="stopPtz"
              title="Kanan Atas"
            >
              <svg class="w-4 h-4 rotate-45" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
            </button>

            <!-- Left -->
            <button
              type="button"
              class="ptz-btn"
              @pointerdown="startPtz(-0.8, 0)"
              @pointerup="stopPtz"
              @pointerleave="stopPtz"
              title="Kiri"
            >
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <!-- Center / Stop -->
            <button
              type="button"
              class="ptz-btn center"
              @click="stopPtz"
              title="Pusat / Berhenti"
            >
              <div class="w-2.5 h-2.5 rounded-full bg-indigo-500 dark:bg-indigo-400"></div>
            </button>
            <!-- Right -->
            <button
              type="button"
              class="ptz-btn"
              @pointerdown="startPtz(0.8, 0)"
              @pointerup="stopPtz"
              @pointerleave="stopPtz"
              title="Kanan"
            >
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
            </button>

            <!-- Bottom Left -->
            <button
              type="button"
              class="ptz-btn"
              @pointerdown="startPtz(-0.6, -0.6)"
              @pointerup="stopPtz"
              @pointerleave="stopPtz"
              title="Kiri Bawah"
            >
              <svg class="w-4 h-4 -rotate-135" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
            </button>
            <!-- Down -->
            <button
              type="button"
              class="ptz-btn"
              @pointerdown="startPtz(0, -0.8)"
              @pointerup="stopPtz"
              @pointerleave="stopPtz"
              title="Bawah"
            >
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
            </button>
            <!-- Bottom Right -->
            <button
              type="button"
              class="ptz-btn"
              @pointerdown="startPtz(0.6, -0.6)"
              @pointerup="stopPtz"
              @pointerleave="stopPtz"
              title="Kanan Bawah"
            >
              <svg class="w-4 h-4 rotate-135" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
            </button>
          </div>

          <!-- Zoom In / Zoom Out Controls -->
          <div class="flex items-center gap-3 w-full max-w-[220px]">
            <button
              type="button"
              class="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-medium text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 transition"
              @pointerdown="startZoom(-0.5)"
              @pointerup="stopPtz"
              @pointerleave="stopPtz"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
              Zoom -
            </button>
            <button
              type="button"
              class="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-medium text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 transition"
              @pointerdown="startZoom(0.5)"
              @pointerup="stopPtz"
              @pointerleave="stopPtz"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
              Zoom +
            </button>
          </div>
        </div>
      </div>

      <!-- SECTION 2: DAY / NIGHT IR CUT FILTER (If Supported) -->
      <div v-if="hasImaging" class="p-4 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/80 space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-amber-500 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            <h4 class="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">Mode Siang / Malam (IR-Cut)</h4>
          </div>
          <span class="text-[10px] text-zinc-500 font-mono">{{ imagingForm.irCutFilter }}</span>
        </div>

        <!-- Segmented Mode Control -->
        <div class="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80">
          <button
            type="button"
            class="py-1.5 px-2 rounded text-xs font-medium transition"
            :class="imagingForm.irCutFilter === 'AUTO' ? 'bg-indigo-600 text-white font-semibold shadow' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'"
            @click="setIrCut('AUTO')"
          >
            AUTO
          </button>
          <button
            type="button"
            class="py-1.5 px-2 rounded text-xs font-medium transition flex items-center justify-center gap-1"
            :class="imagingForm.irCutFilter === 'ON' ? 'bg-amber-600 text-white font-semibold shadow' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'"
            @click="setIrCut('ON')"
          >
            <span>☀️</span> Siang
          </button>
          <button
            type="button"
            class="py-1.5 px-2 rounded text-xs font-medium transition flex items-center justify-center gap-1"
            :class="imagingForm.irCutFilter === 'OFF' ? 'bg-blue-600 text-white font-semibold shadow' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'"
            @click="setIrCut('OFF')"
          >
            <span>🌙</span> Malam (IR)
          </button>
        </div>
      </div>

      <!-- SECTION 3: IMAGE TUNING (Brightness, Contrast, Saturation, Sharpness) -->
      <div v-if="hasImaging" class="p-4 rounded-xl bg-zinc-50/80 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800/80 space-y-3.5">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">Penyesuaian Citra Sensor</h4>
          <button
            type="button"
            class="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            :disabled="savingImaging"
            @click="saveImaging"
          >
            {{ savingImaging ? 'Menerapkan...' : 'Terapkan' }}
          </button>
        </div>

        <!-- Brightness Slider -->
        <div class="space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="text-zinc-600 dark:text-zinc-400">Kecerahan (Brightness)</span>
            <span class="font-mono text-zinc-900 dark:text-zinc-200">{{ imagingForm.brightness }}</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            v-model.number="imagingForm.brightness"
            class="w-full accent-indigo-500 bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
          />
        </div>

        <!-- Contrast Slider -->
        <div class="space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="text-zinc-600 dark:text-zinc-400">Kontras (Contrast)</span>
            <span class="font-mono text-zinc-900 dark:text-zinc-200">{{ imagingForm.contrast }}</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            v-model.number="imagingForm.contrast"
            class="w-full accent-indigo-500 bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
          />
        </div>

        <!-- Saturation Slider -->
        <div class="space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="text-zinc-600 dark:text-zinc-400">Saturasi Warna</span>
            <span class="font-mono text-zinc-900 dark:text-zinc-200">{{ imagingForm.colorSaturation }}</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            v-model.number="imagingForm.colorSaturation"
            class="w-full accent-indigo-500 bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
          />
        </div>

        <!-- Sharpness Slider -->
        <div class="space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="text-zinc-600 dark:text-zinc-400">Ketajaman (Sharpness)</span>
            <span class="font-mono text-zinc-900 dark:text-zinc-200">{{ imagingForm.sharpness }}</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            v-model.number="imagingForm.sharpness"
            class="w-full accent-indigo-500 bg-zinc-200 dark:bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
          />
        </div>

        <!-- WDR Toggle -->
        <div class="flex items-center justify-between pt-1">
          <span class="text-xs text-zinc-600 dark:text-zinc-400">WDR (Wide Dynamic Range)</span>
          <button
            type="button"
            class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
            :class="imagingForm.wdr ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'"
            @click="imagingForm.wdr = !imagingForm.wdr"
          >
            <span
              class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
              :class="imagingForm.wdr ? 'translate-x-4' : 'translate-x-0'"
            />
          </button>
        </div>
      </div>

      <!-- SECTION 4: HARDWARE REBOOT -->
      <div class="pt-1">
        <button
          type="button"
          class="w-full py-2 px-3 rounded-lg border border-red-500/30 hover:bg-red-500/10 text-red-500 dark:text-red-400 text-xs font-medium transition flex items-center justify-center gap-1.5"
          :disabled="isRebooting"
          @click="confirmReboot"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {{ isRebooting ? 'Mengirim perintah reboot...' : 'Reboot Perangkat Kamera' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from "vue";
import { apiFetch } from "../services/api.js";

const props = defineProps<{
  cameraId: number;
}>();

const loading = ref<boolean>(true);
const supported = ref<boolean>(false);
const hasPtz = ref<boolean>(false);
const hasImaging = ref<boolean>(false);
const savingImaging = ref<boolean>(false);
const isRebooting = ref<boolean>(false);

const imagingForm = reactive({
  irCutFilter: "AUTO",
  brightness: 50,
  contrast: 50,
  colorSaturation: 50,
  sharpness: 50,
  wdr: false,
});

const loadControls = async () => {
  if (!props.cameraId) return;
  loading.value = true;
  try {
    const res = await apiFetch(`/api/onvif/camera/${props.cameraId}/controls`);
    if (!res.ok) {
      supported.value = false;
      return;
    }
    const data = await res.json();
    supported.value = Boolean(data.supported);
    hasPtz.value = Boolean(data.hasPtz);
    hasImaging.value = Boolean(data.hasImaging);

    if (data.imagingSettings) {
      imagingForm.irCutFilter = data.imagingSettings.irCutFilter || "AUTO";
      imagingForm.brightness = data.imagingSettings.brightness ?? 50;
      imagingForm.contrast = data.imagingSettings.contrast ?? 50;
      imagingForm.colorSaturation = data.imagingSettings.colorSaturation ?? 50;
      imagingForm.sharpness = data.imagingSettings.sharpness ?? 50;
      imagingForm.wdr = Boolean(data.imagingSettings.wdr);
    }
  } catch {
    supported.value = false;
  } finally {
    loading.value = false;
  }
};

const startPtz = async (x: number, y: number) => {
  try {
    await apiFetch(`/api/onvif/camera/${props.cameraId}/ptz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", x, y }),
    });
  } catch {}
};

const startZoom = async (zoom: number) => {
  try {
    await apiFetch(`/api/onvif/camera/${props.cameraId}/ptz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", zoom }),
    });
  } catch {}
};

const stopPtz = async () => {
  try {
    await apiFetch(`/api/onvif/camera/${props.cameraId}/ptz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
  } catch {}
};

const setIrCut = async (mode: string) => {
  imagingForm.irCutFilter = mode;
  await saveImaging();
};

const saveImaging = async () => {
  savingImaging.value = true;
  try {
    await apiFetch(`/api/onvif/camera/${props.cameraId}/imaging`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        irCutFilter: imagingForm.irCutFilter,
        brightness: imagingForm.brightness,
        contrast: imagingForm.contrast,
        colorSaturation: imagingForm.colorSaturation,
        sharpness: imagingForm.sharpness,
        wdr: imagingForm.wdr,
      }),
    });
  } catch {
  } finally {
    savingImaging.value = false;
  }
};

const confirmReboot = async () => {
  if (!confirm(`Reboot kamera hardware sekarang? Kamera akan offline sekitar 30-60 detik.`)) {
    return;
  }
  isRebooting.value = true;
  try {
    const res = await apiFetch(`/api/onvif/camera/${props.cameraId}/reboot`, {
      method: "POST",
    });
    const d = await res.json();
    alert(d.message || "Perintah reboot berhasil dikirim.");
  } catch (err: any) {
    alert("Gagal reboot: " + err.message);
  } finally {
    isRebooting.value = false;
  }
};

watch(() => props.cameraId, () => {
  loadControls();
});

onMounted(() => {
  loadControls();
});
</script>

<style scoped>
.ptz-grid {
  display: grid;
  grid-template-columns: repeat(3, 44px);
  grid-template-rows: repeat(3, 44px);
  gap: 6px;
  justify-content: center;
}

.ptz-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #f4f4f5;
  color: #18181b;
  border: 1px solid rgba(0, 0, 0, 0.1);
  transition: all 0.15s ease;
  user-select: none;
  cursor: pointer;
}

:root.dark .ptz-btn,
.dark .ptz-btn {
  background: #27272a;
  color: #e4e4e7;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.ptz-btn:hover {
  background: #e4e4e7;
  color: #000000;
}

:root.dark .ptz-btn:hover,
.dark .ptz-btn:hover {
  background: #3f3f46;
  color: #ffffff;
}

.ptz-btn:active {
  background: #6366f1;
  color: #ffffff;
  transform: scale(0.94);
}

.ptz-btn.center {
  background: #ffffff;
  border-color: rgba(99, 102, 241, 0.4);
}

:root.dark .ptz-btn.center,
.dark .ptz-btn.center {
  background: #18181b;
  border-color: rgba(99, 102, 241, 0.3);
}

.ptz-btn.center:hover {
  background: rgba(99, 102, 241, 0.15);
}
</style>
