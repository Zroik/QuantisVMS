<template>
  <div class="flex flex-col space-y-4">
    <!-- Header with active class count & reset -->
    <div class="flex items-center justify-between pb-2 border-b border-zinc-200/80 dark:border-zinc-800/80">
      <div>
        <h4 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ $t('toggle.title') }}</h4>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{{ $t('toggle.subtitle') }}</p>
      </div>
      <div class="flex items-center space-x-2">
        <Badge variant="default">
          <span class="tabular-nums">{{ activeClasses.length }}</span> {{ $t('toggle.activeCount') }}
        </Badge>
        <Button variant="ghost" size="sm" @click="resetToDefaults" :aria-label="$t('toggle.resetDefaults')">
          {{ $t('toggle.resetDefaults') }}
        </Button>
      </div>
    </div>

    <!-- Confidence Slider Row -->
    <div class="p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-[#1C1C1E]/50 flex flex-col space-y-2">
      <div class="flex items-center justify-between text-xs font-medium">
        <span class="text-zinc-700 dark:text-zinc-300">{{ $t('toggle.confidence') }}</span>
        <span class="tabular-nums font-mono text-zinc-900 dark:text-zinc-100 font-semibold">
          {{ (confidenceThreshold * 100).toFixed(0) }}%
        </span>
      </div>
      <Slider
        v-model="confidenceThreshold"
        :min="0.1"
        :max="0.9"
        :step="0.05"
        @update:model-value="onConfidenceChange"
        aria-label="Confidence threshold slider"
      />
    </div>

    <!-- Grouped Preset Rows (iOS Settings style divide-y) -->
    <div class="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#1C1C1E] overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800/60 shadow-xs">
      <!-- Person Group -->
      <div class="flex items-center justify-between p-3.5 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors">
        <div class="flex flex-col pr-4">
          <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{{ $t('toggle.person') }}</span>
          <span class="text-xs text-zinc-400">COCO #0</span>
        </div>
        <Switch
          :model-value="isGroupActive('person')"
          @update:model-value="toggleGroup('person', $event)"
          :aria-label="$t('toggle.person')"
        />
      </div>

      <!-- Vehicles Group -->
      <div class="flex items-center justify-between p-3.5 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors">
        <div class="flex flex-col pr-4">
          <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{{ $t('toggle.vehicles') }}</span>
          <span class="text-xs text-zinc-400">COCO #1, #2, #3, #5, #7</span>
        </div>
        <Switch
          :model-value="isGroupActive('vehicles')"
          @update:model-value="toggleGroup('vehicles', $event)"
          :aria-label="$t('toggle.vehicles')"
        />
      </div>

      <!-- Pets Group -->
      <div class="flex items-center justify-between p-3.5 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors">
        <div class="flex flex-col pr-4">
          <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{{ $t('toggle.pets') }}</span>
          <span class="text-xs text-zinc-400">COCO #14, #15, #16</span>
        </div>
        <Switch
          :model-value="isGroupActive('pets')"
          @update:model-value="toggleGroup('pets', $event)"
          :aria-label="$t('toggle.pets')"
        />
      </div>

      <!-- Luggage Group -->
      <div class="flex items-center justify-between p-3.5 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors">
        <div class="flex flex-col pr-4">
          <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{{ $t('toggle.luggage') }}</span>
          <span class="text-xs text-zinc-400">COCO #24, #25, #26, #28</span>
        </div>
        <Switch
          :model-value="isGroupActive('luggage')"
          @update:model-value="toggleGroup('luggage', $event)"
          :aria-label="$t('toggle.luggage')"
        />
      </div>

      <!-- Sharp & Dangerous Group -->
      <div class="flex items-center justify-between p-3.5 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors">
        <div class="flex flex-col pr-4">
          <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{{ $t('toggle.sharpDangerous') }}</span>
          <span class="text-xs text-zinc-400">COCO #34, #39, #43, #76</span>
        </div>
        <Switch
          :model-value="isGroupActive('sharpDangerous')"
          @update:model-value="toggleGroup('sharpDangerous', $event)"
          :aria-label="$t('toggle.sharpDangerous')"
        />
      </div>

      <!-- Devices Group -->
      <div class="flex items-center justify-between p-3.5 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors">
        <div class="flex flex-col pr-4">
          <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{{ $t('toggle.devices') }}</span>
          <span class="text-xs text-zinc-400">COCO #62, #63, #64, #66, #67</span>
        </div>
        <Switch
          :model-value="isGroupActive('devices')"
          @update:model-value="toggleGroup('devices', $event)"
          :aria-label="$t('toggle.devices')"
        />
      </div>
    </div>

    <!-- Advanced Class Drawer Trigger -->
    <div class="flex items-center justify-between pt-1">
      <Button variant="outline" class="w-full" @click="isDrawerOpen = !isDrawerOpen">
        {{ $t('toggle.advancedDrawer') }} ({{ isDrawerOpen ? $t('common.close') : '80 Classes' }})
      </Button>
    </div>

    <!-- Searchable Advanced Class Drawer (COCO 80) -->
    <div
      v-if="isDrawerOpen"
      class="p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/80 dark:bg-[#1C1C1E]/80 flex flex-col space-y-3"
    >
      <Input
        v-model="searchQuery"
        :placeholder="$t('toggle.searchClasses')"
      />

      <div class="max-h-56 overflow-y-auto space-y-1 pr-1 divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
        <div
          v-for="cls in filteredClasses"
          :key="cls.id"
          class="flex items-center justify-between py-2 text-xs"
        >
          <span class="text-zinc-800 dark:text-zinc-200 font-medium">
            <span class="tabular-nums font-mono text-zinc-400 mr-2">#{{ cls.id }}</span>
            {{ cls.name }}
          </span>
          <Switch
            :model-value="activeClasses.includes(cls.id)"
            @update:model-value="toggleClass(cls.id, $event)"
            :aria-label="cls.name"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import Switch from "./ui/Switch.vue";
import Slider from "./ui/Slider.vue";
import Button from "./ui/Button.vue";
import Badge from "./ui/Badge.vue";
import Input from "./ui/Input.vue";
import { useCamerasStore } from "../stores/cameras.js";

const props = defineProps<{
  cameraId: number;
  initialClasses?: number[];
  initialConfidence?: number;
}>();

const emit = defineEmits<{
  (e: "change", classes: number[], confidence: number): void;
}>();

const camerasStore = useCamerasStore();
const isDrawerOpen = ref<boolean>(false);
const searchQuery = ref<string>("");

// Preset Groups matching Spec Appendix A
const PRESET_GROUPS: Record<string, number[]> = {
  person: [0],
  vehicles: [1, 2, 3, 5, 7],
  pets: [14, 15, 16],
  luggage: [24, 25, 26, 28],
  sharpDangerous: [34, 39, 43, 76],
  devices: [62, 63, 64, 66, 67],
};

// Full COCO 80 classes list
const ALL_COCO_CLASSES = [
  { id: 0, name: "person" }, { id: 1, name: "bicycle" }, { id: 2, name: "car" }, { id: 3, name: "motorcycle" },
  { id: 4, name: "airplane" }, { id: 5, name: "bus" }, { id: 6, name: "train" }, { id: 7, name: "truck" },
  { id: 8, name: "boat" }, { id: 9, name: "traffic light" }, { id: 10, name: "fire hydrant" }, { id: 11, name: "stop sign" },
  { id: 12, name: "parking meter" }, { id: 13, name: "bench" }, { id: 14, name: "bird" }, { id: 15, name: "cat" },
  { id: 16, name: "dog" }, { id: 17, name: "horse" }, { id: 18, name: "sheep" }, { id: 19, name: "cow" },
  { id: 20, name: "elephant" }, { id: 21, name: "bear" }, { id: 22, name: "zebra" }, { id: 23, name: "giraffe" },
  { id: 24, name: "backpack" }, { id: 25, name: "umbrella" }, { id: 26, name: "handbag" }, { id: 27, name: "tie" },
  { id: 28, name: "suitcase" }, { id: 29, name: "frisbee" }, { id: 30, name: "skis" }, { id: 31, name: "snowboard" },
  { id: 32, name: "sports ball" }, { id: 33, name: "kite" }, { id: 34, name: "baseball bat" }, { id: 35, name: "baseball glove" },
  { id: 36, name: "skateboard" }, { id: 37, name: "surfboard" }, { id: 38, name: "tennis racket" }, { id: 39, name: "bottle" },
  { id: 40, name: "wine glass" }, { id: 41, name: "cup" }, { id: 42, name: "fork" }, { id: 43, name: "knife" },
  { id: 44, name: "spoon" }, { id: 45, name: "bowl" }, { id: 46, name: "banana" }, { id: 47, name: "apple" },
  { id: 48, name: "sandwich" }, { id: 49, name: "orange" }, { id: 50, name: "broccoli" }, { id: 51, name: "carrot" },
  { id: 52, name: "hot dog" }, { id: 53, name: "pizza" }, { id: 54, name: "donut" }, { id: 55, name: "cake" },
  { id: 56, name: "chair" }, { id: 57, name: "couch" }, { id: 58, name: "potted plant" }, { id: 59, name: "bed" },
  { id: 60, name: "dining table" }, { id: 61, name: "toilet" }, { id: 62, name: "tv" }, { id: 63, name: "laptop" },
  { id: 64, name: "mouse" }, { id: 65, name: "remote" }, { id: 66, name: "keyboard" }, { id: 67, name: "cell phone" },
  { id: 68, name: "microwave" }, { id: 69, name: "oven" }, { id: 70, name: "toaster" }, { id: 71, name: "sink" },
  { id: 72, name: "refrigerator" }, { id: 73, name: "book" }, { id: 74, name: "clock" }, { id: 75, name: "vase" },
  { id: 76, name: "scissors" }, { id: 77, name: "teddy bear" }, { id: 78, name: "hair drier" }, { id: 79, name: "toothbrush" }
];

const activeClasses = ref<number[]>(props.initialClasses || [0, 1, 2, 3, 5, 7, 14, 15, 16]);
const confidenceThreshold = ref<number>(props.initialConfidence || 0.25);

const filteredClasses = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return ALL_COCO_CLASSES;
  return ALL_COCO_CLASSES.filter((c) => c.name.toLowerCase().includes(q) || String(c.id).includes(q));
});

const isGroupActive = (groupName: string): boolean => {
  const ids = PRESET_GROUPS[groupName] || [];
  return ids.every((id) => activeClasses.value.includes(id));
};

const commitChanges = async () => {
  emit("change", activeClasses.value, confidenceThreshold.value);
  if (props.cameraId) {
    await camerasStore.updateCameraClasses(
      props.cameraId,
      activeClasses.value,
      confidenceThreshold.value
    );
  }
};

const toggleGroup = (groupName: string, state: boolean) => {
  const ids = PRESET_GROUPS[groupName] || [];
  if (state) {
    // Add all ids in group
    const set = new Set([...activeClasses.value, ...ids]);
    activeClasses.value = Array.from(set).sort((a, b) => a - b);
  } else {
    // Remove ids in group
    activeClasses.value = activeClasses.value.filter((id) => !ids.includes(id));
  }
  commitChanges();
};

const toggleClass = (classId: number, state: boolean) => {
  if (state) {
    if (!activeClasses.value.includes(classId)) {
      activeClasses.value = [...activeClasses.value, classId].sort((a, b) => a - b);
    }
  } else {
    activeClasses.value = activeClasses.value.filter((id) => id !== classId);
  }
  commitChanges();
};

const onConfidenceChange = (val: number) => {
  confidenceThreshold.value = val;
  commitChanges();
};

const resetToDefaults = () => {
  activeClasses.value = [0, 1, 2, 3, 5, 7, 14, 15, 16]; // Person, Vehicles, Pets
  confidenceThreshold.value = 0.25;
  commitChanges();
};
</script>

