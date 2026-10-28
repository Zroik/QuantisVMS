<template>
  <div class="flex flex-col space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between pb-2 border-b border-zinc-200/80 dark:border-zinc-800/80">
      <div>
        <h2 class="text-lg sm:text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {{ $t('hw.title') }}
        </h2>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          AMD Ryzen 7 7745HX & NVIDIA GeForce RTX 4060 Laptop GPU
        </p>
      </div>

      <Badge :variant="telemetryStore.hwStats.gpuTemp < 80 ? 'success' : 'warning'">
        {{ telemetryStore.hwStats.gpuTemp < 80 ? $t('hw.healthy') : $t('hw.warning') }}
      </Badge>
    </div>

    <!-- GPU Telemetry Section -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- GPU Load -->
      <Card class="p-4 flex flex-col justify-between">
        <div class="flex items-center justify-between text-xs text-zinc-500 mb-2">
          <span>{{ $t('hw.gpuUtil') }}</span>
          <Cpu class="h-4 w-4 text-[#007AFF]" />
        </div>
        <div>
          <div class="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
            {{ telemetryStore.hwStats.gpuUtil }}%
          </div>
          <!-- Progress Bar -->
          <div class="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden mt-3">
            <div class="h-full bg-[#007AFF]" :style="{ width: `${telemetryStore.hwStats.gpuUtil}%` }"></div>
          </div>
        </div>
      </Card>

      <!-- VRAM Usage -->
      <Card class="p-4 flex flex-col justify-between">
        <div class="flex items-center justify-between text-xs text-zinc-500 mb-2">
          <span>{{ $t('hw.vramUsage') }}</span>
          <Server class="h-4 w-4 text-[#34C759]" />
        </div>
        <div>
          <div class="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
            {{ (telemetryStore.hwStats.vramUsedMb / 1024).toFixed(2) }} <span class="text-xs font-normal text-zinc-400">/ 8.00 GB</span>
          </div>
          <div class="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden mt-3">
            <div
              class="h-full bg-[#34C759]"
              :style="{ width: `${(telemetryStore.hwStats.vramUsedMb / telemetryStore.hwStats.vramTotalMb) * 100}%` }"
            ></div>
          </div>
        </div>
      </Card>

      <!-- GPU Temperature -->
      <Card class="p-4 flex flex-col justify-between">
        <div class="flex items-center justify-between text-xs text-zinc-500 mb-2">
          <span>{{ $t('hw.gpuTemp') }}</span>
          <Thermometer class="h-4 w-4 text-[#FF9500]" />
        </div>
        <div>
          <div class="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
            {{ telemetryStore.hwStats.gpuTemp }} °C
          </div>
          <div class="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden mt-3">
            <div
              class="h-full"
              :class="telemetryStore.hwStats.gpuTemp > 75 ? 'bg-[#FF3B30]' : 'bg-[#FF9500]'"
              :style="{ width: `${Math.min(100, (telemetryStore.hwStats.gpuTemp / 90) * 100)}%` }"
            ></div>
          </div>
        </div>
      </Card>

      <!-- NVENC Status -->
      <Card class="p-4 flex flex-col justify-between">
        <div class="flex items-center justify-between text-xs text-zinc-500 mb-2">
          <span>{{ $t('hw.nvencActive') }}</span>
          <Activity class="h-4 w-4 text-[#007AFF]" />
        </div>
        <div>
          <Badge :variant="telemetryStore.hwStats.nvencActive ? 'success' : 'secondary'" class="text-sm px-2.5 py-1">
            {{ telemetryStore.hwStats.nvencActive ? 'ACTIVE (ENCODING)' : 'IDLE' }}
          </Badge>
          <p class="text-[10px] text-zinc-400 mt-3 font-mono">AV1 & HEVC Dual Engine</p>
        </div>
      </Card>
    </div>

    <!-- Disk Storage & Watermarks Card -->
    <Card class="p-5">
      <div class="flex items-center justify-between mb-2">
        <CardTitle>{{ $t('hw.diskUsage') }}</CardTitle>
        <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">
          {{ telemetryStore.hwStats.diskPercent.toFixed(1) }}% Used
        </span>
      </div>
      <p class="text-xs text-zinc-500 mb-4">
        Spec §8.7 Enforce High Watermark (85%) & Critical Watermark (95%)
      </p>

      <!-- Storage Bar with Watermark Indicators -->
      <div class="relative w-full h-4 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
        <!-- Current Usage Bar -->
        <div
          class="h-full transition-all duration-300"
          :class="[
            telemetryStore.hwStats.diskPercent >= 95
              ? 'bg-[#FF3B30]'
              : telemetryStore.hwStats.diskPercent >= 85
              ? 'bg-[#FF9500]'
              : 'bg-[#007AFF]',
          ]"
          :style="{ width: `${telemetryStore.hwStats.diskPercent}%` }"
        ></div>

        <!-- 85% High Watermark Marker Line -->
        <div class="absolute top-0 bottom-0 left-[85%] w-0.5 bg-amber-500 z-10" title="85% High Watermark"></div>
        <!-- 95% Critical Watermark Marker Line -->
        <div class="absolute top-0 bottom-0 left-[95%] w-0.5 bg-red-500 z-10" title="95% Critical Watermark"></div>
      </div>

      <div class="flex items-center justify-between text-[11px] text-zinc-400 mt-2 tabular-nums">
        <span>0 GB</span>
        <span class="text-amber-500 font-semibold">85% High Watermark</span>
        <span class="text-red-500 font-semibold">95% Critical</span>
        <span>1.0 TB</span>
      </div>
    </Card>

    <!-- CPU & RAM Section -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Card class="p-4">
        <span class="text-xs font-medium text-zinc-500">{{ $t('hw.cpuUtil') }}</span>
        <div class="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mt-1 tabular-nums">
          {{ telemetryStore.hwStats.cpuPercent.toFixed(1) }}%
        </div>
        <div class="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden mt-3">
          <div class="h-full bg-[#007AFF]" :style="{ width: `${telemetryStore.hwStats.cpuPercent}%` }"></div>
        </div>
      </Card>

      <Card class="p-4">
        <span class="text-xs font-medium text-zinc-500">{{ $t('hw.ramUsage') }}</span>
        <div class="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mt-1 tabular-nums">
          {{ telemetryStore.hwStats.ramPercent.toFixed(1) }}%
        </div>
        <div class="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden mt-3">
          <div class="h-full bg-[#34C759]" :style="{ width: `${telemetryStore.hwStats.ramPercent}%` }"></div>
        </div>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { Cpu, Server, Thermometer, Activity } from "lucide-vue-next";
import Card from "../components/ui/Card.vue";
import CardTitle from "../components/ui/CardTitle.vue";
import Badge from "../components/ui/Badge.vue";
import { useTelemetryStore } from "../stores/telemetry.js";

const telemetryStore = useTelemetryStore();

onMounted(() => {
  telemetryStore.fetchStats();
});
</script>

