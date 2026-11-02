<template>
  <div class="settings-view flex flex-col space-y-6">
    <!-- Hero / Header -->
    <section class="hero">
      <div>
        <p class="eyebrow">Konfigurasi</p>
        <h1>Pengaturan kamera &amp; sistem</h1>
        <p class="spec mono">Manajemen aliran RTSP &nbsp;/&nbsp; Kebijakan kompresi encoder NVENC</p>
      </div>

      <button class="btn" style="background:var(--accent);color:#fff" @click="openAddModal">
        <Plus class="h-4 w-4 mr-1.5" />
        <span>Tambah kamera</span>
      </button>
    </section>

    <!-- Cameras Table -->
    <section class="card" aria-label="Daftar Kamera">
      <div class="head">
        <div>
          <h2>Kamera terdaftar</h2>
          <p class="sub">Aliran RTSP kamera, resolusi stream, dan target kualitas VMAF</p>
        </div>
      </div>

      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nama Kamera</th>
              <th>Host / Alamat IP</th>
              <th>Enkoder Perangkat Keras</th>
              <th>Target VMAF</th>
              <th>Sampling AI</th>
              <th style="text-align:right">Tindakan</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="camerasStore.cameras.length === 0">
              <td colspan="7" style="text-align:center; padding: 32px; color: var(--faint)">
                <div v-if="camerasStore.isLoading">Memuat daftar kamera...</div>
                <div v-else-if="camerasStore.error" style="color:var(--crit)">{{ camerasStore.error }}</div>
                <div v-else>Belum ada kamera tersimpan. Silakan klik "Tambah kamera".</div>
              </td>
            </tr>
            <tr v-for="cam in camerasStore.cameras" :key="cam.id">
              <td class="mono font-semibold">#{{ cam.id }}</td>
              <td><b>{{ cam.name }}</b></td>
              <td class="mono">{{ cam.rtsp_host }}</td>
              <td class="mono">
                <span class="pill" style="padding:2px 8px; font-size:11px">{{ cam.preferred_encoder }}</span>
              </td>
              <td class="mono">
                <b style="color:var(--accent)">{{ cam.target_vmaf }}</b> <em>(P25: {{ cam.target_vmaf_p25 }})</em>
              </td>
              <td>
                <span class="ok" v-if="cam.smart_ai_sampling">AI Peak</span>
                <span class="sub" v-else>Blind</span>
              </td>
              <td style="text-align:right">
                <div style="display:inline-flex; gap:6px; justify-content:flex-end">
                  <button class="btn" style="min-height:30px; padding:0 10px; font-size:12px; box-shadow:var(--ring)" @click="openEditModal(cam)">
                    Ubah
                  </button>
                  <button class="btn" style="min-height:30px; padding:0 10px; font-size:12px; color:var(--crit)" @click="handleDelete(cam.id)">
                    Hapus
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Modal Form (Add / Edit) -->
    <div
      v-if="isModalOpen"
      class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
    >
      <Card class="w-full max-w-lg p-6 bg-white dark:bg-[#1C1C1E] shadow-xs">
        <h3 class="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-4">
          {{ editingCamId ? $t('settings.editCamera') : $t('settings.addCamera') }}
        </h3>

        <div v-if="saveError" class="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
          {{ saveError }}
        </div>

        <form @submit.prevent="handleSave" class="space-y-4 text-xs">
          <div>
            <label class="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">{{ $t('settings.camName') }}</label>
            <Input v-model="form.name" required placeholder="Front Entrance Cam" />
          </div>

          <div>
            <label class="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {{ $t('settings.rtspUrl') }} (Encrypted at Rest with AES-256-GCM)
            </label>
            <Input v-model="form.rtsp_url" :required="!editingCamId" placeholder="rtsp://admin:pass@192.168.1.100:554/stream1" />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">{{ $t('settings.preferredEncoder') }}</label>
              <select
                v-model="form.preferred_encoder"
                class="h-9 w-full rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#1C1C1E] px-3 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
              >
                <option value="av1_nvenc">AV1 NVENC</option>
                <option value="hevc_nvenc">HEVC NVENC</option>
              </select>
            </div>

            <div>
              <label class="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">{{ $t('settings.targetVmaf') }}</label>
              <Input v-model.number="form.target_vmaf" type="number" step="0.5" min="60" max="98" />
            </div>
          </div>

          <div class="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800/80">
            <span class="font-medium text-zinc-800 dark:text-zinc-200">{{ $t('settings.smartSampling') }}</span>
            <Switch v-model="form.smart_ai_sampling" :aria-label="$t('settings.smartSampling')" />
          </div>

          <div class="flex items-center justify-end space-x-2 pt-4 border-t border-zinc-200/80 dark:border-zinc-800/80">
            <Button variant="ghost" type="button" @click="isModalOpen = false">{{ $t('settings.cancel') }}</Button>
            <Button type="submit" :disabled="isSaving">{{ isSaving ? 'Menyimpan...' : $t('settings.save') }}</Button>
          </div>
        </form>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { Plus } from "lucide-vue-next";
import Card from "../components/ui/Card.vue";
import CardHeader from "../components/ui/CardHeader.vue";
import CardTitle from "../components/ui/CardTitle.vue";
import Button from "../components/ui/Button.vue";
import Badge from "../components/ui/Badge.vue";
import Input from "../components/ui/Input.vue";
import Switch from "../components/ui/Switch.vue";
import { useCamerasStore, type Camera } from "../stores/cameras.js";

const camerasStore = useCamerasStore();

const isModalOpen = ref<boolean>(false);
const editingCamId = ref<number | null>(null);
const saveError = ref<string | null>(null);
const isSaving = ref<boolean>(false);

const form = reactive({
  name: "",
  rtsp_url: "",
  preferred_encoder: "av1_nvenc",
  target_vmaf: 80.0,
  target_vmaf_p25: 75.0,
  smart_ai_sampling: true,
});

const openAddModal = () => {
  editingCamId.value = null;
  saveError.value = null;
  form.name = "";
  form.rtsp_url = "";
  form.preferred_encoder = "av1_nvenc";
  form.target_vmaf = 80.0;
  form.target_vmaf_p25 = 75.0;
  form.smart_ai_sampling = true;
  isModalOpen.value = true;
};

const openEditModal = (cam: Camera) => {
  editingCamId.value = cam.id;
  saveError.value = null;
  form.name = cam.name;
  form.rtsp_url = "";
  form.preferred_encoder = cam.preferred_encoder || "av1_nvenc";
  form.target_vmaf = cam.target_vmaf || 80.0;
  form.target_vmaf_p25 = cam.target_vmaf_p25 || 75.0;
  form.smart_ai_sampling = Boolean(cam.smart_ai_sampling);
  isModalOpen.value = true;
};

const handleSave = async () => {
  saveError.value = null;
  isSaving.value = true;
  let ok = false;
  try {
    if (editingCamId.value) {
      const payload: any = {
        name: form.name,
        preferred_encoder: form.preferred_encoder,
        target_vmaf: Number(form.target_vmaf),
        target_vmaf_p25: Number(form.target_vmaf_p25),
        smart_ai_sampling: Boolean(form.smart_ai_sampling),
      };
      if (form.rtsp_url) payload.rtsp_url = form.rtsp_url;
      ok = await camerasStore.updateCamera(editingCamId.value, payload);
    } else {
      ok = await camerasStore.createCamera({
        name: form.name,
        rtsp_url: form.rtsp_url,
        preferred_encoder: form.preferred_encoder,
        target_vmaf: Number(form.target_vmaf),
        target_vmaf_p25: Number(form.target_vmaf_p25),
        smart_ai_sampling: Boolean(form.smart_ai_sampling),
      });
    }
    if (!ok) {
      saveError.value = camerasStore.error || "Gagal menyimpan kamera. Pastikan URL diawali rtsp://";
      return;
    }
    isModalOpen.value = false;
  } finally {
    isSaving.value = false;
  }
};

const handleDelete = async (id: number) => {
  if (confirm("Delete this camera?")) {
    await camerasStore.deleteCamera(id);
  }
};

onMounted(() => {
  camerasStore.fetchCameras();
});
</script>
