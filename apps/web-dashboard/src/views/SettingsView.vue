<template>
  <div class="flex flex-col space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between pb-2 border-b border-zinc-200/80 dark:border-zinc-800/80">
      <div>
        <h2 class="text-lg sm:text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {{ $t('settings.title') }}
        </h2>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          {{ $t('settings.compressionPolicy') }} & {{ $t('settings.camerasTab') }}
        </p>
      </div>

      <Button size="sm" @click="openAddModal">
        <Plus class="h-4 w-4 mr-1.5" />
        {{ $t('settings.addCamera') }}
      </Button>
    </div>

    <!-- Cameras Table -->
    <Card class="overflow-hidden">
      <CardHeader>
        <CardTitle>{{ $t('settings.camerasTab') }}</CardTitle>
      </CardHeader>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
          <thead class="bg-zinc-50 dark:bg-zinc-900/60 font-semibold text-zinc-500">
            <tr>
              <th class="px-4 py-3">ID</th>
              <th class="px-4 py-3">{{ $t('settings.camName') }}</th>
              <th class="px-4 py-3">{{ $t('settings.rtspHost') }}</th>
              <th class="px-4 py-3">{{ $t('settings.preferredEncoder') }}</th>
              <th class="px-4 py-3">{{ $t('settings.targetVmaf') }}</th>
              <th class="px-4 py-3">{{ $t('settings.smartSampling') }}</th>
              <th class="px-4 py-3 text-right">{{ $t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/40">
            <tr v-for="cam in camerasStore.cameras" :key="cam.id" class="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
              <td class="px-4 py-3 font-mono font-medium text-zinc-500 tabular-nums">#{{ cam.id }}</td>
              <td class="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">{{ cam.name }}</td>
              <td class="px-4 py-3 font-mono text-zinc-600 dark:text-zinc-400">{{ cam.rtsp_host }}</td>
              <td class="px-4 py-3 font-mono">
                <Badge variant="outline">{{ cam.preferred_encoder }}</Badge>
              </td>
              <td class="px-4 py-3 tabular-nums font-semibold text-[#007AFF]">
                {{ cam.target_vmaf }} (p25: {{ cam.target_vmaf_p25 }})
              </td>
              <td class="px-4 py-3">
                <Badge :variant="cam.smart_ai_sampling ? 'success' : 'secondary'">
                  {{ cam.smart_ai_sampling ? 'AI Peak' : 'Blind' }}
                </Badge>
              </td>
              <td class="px-4 py-3 text-right space-x-2">
                <Button variant="outline" size="sm" @click="openEditModal(cam)">
                  {{ $t('settings.editCamera') }}
                </Button>
                <Button variant="destructive" size="sm" @click="handleDelete(cam.id)">
                  {{ $t('settings.deleteCamera') }}
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <!-- Modal Form (Add / Edit) -->
    <div
      v-if="isModalOpen"
      class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
    >
      <Card class="w-full max-w-lg p-6 bg-white dark:bg-[#1C1C1E] shadow-xs">
        <h3 class="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-4">
          {{ editingCamId ? $t('settings.editCamera') : $t('settings.addCamera') }}
        </h3>

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
            <Button type="submit">{{ $t('settings.save') }}</Button>
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
  form.name = cam.name;
  form.rtsp_url = "";
  form.preferred_encoder = cam.preferred_encoder || "av1_nvenc";
  form.target_vmaf = cam.target_vmaf || 80.0;
  form.target_vmaf_p25 = cam.target_vmaf_p25 || 75.0;
  form.smart_ai_sampling = Boolean(cam.smart_ai_sampling);
  isModalOpen.value = true;
};

const handleSave = async () => {
  let ok = false;
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
    alert("Failed to save camera. Please verify the RTSP URL starts with rtsp:// and name is provided.");
    return;
  }
  isModalOpen.value = false;
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
