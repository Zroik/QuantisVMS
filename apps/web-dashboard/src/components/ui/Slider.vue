<template>
  <SliderRoot
    :model-value="[modelValue]"
    @update:model-value="onUpdate"
    :min="min || 0"
    :max="max || 100"
    :step="step || 1"
    :disabled="disabled"
    class="relative flex w-full touch-none select-none items-center"
  >
    <SliderTrack class="relative h-1.5 w-full grow overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
      <SliderRange class="absolute h-full bg-[#007AFF]" />
    </SliderTrack>
    <SliderThumb
      class="block h-4 w-4 rounded-full border border-zinc-200/80 dark:border-zinc-700 bg-white shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
      :aria-label="ariaLabel || 'Slider'"
    />
  </SliderRoot>
</template>

<script setup lang="ts">
import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from "reka-ui";

const props = defineProps<{
  modelValue: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", val: number): void;
}>();

const onUpdate = (val?: number[]) => {
  if (val && val.length > 0) {
    emit("update:modelValue", val[0]);
  }
};
</script>

