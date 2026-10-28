<template>
  <div class="flex flex-col space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between pb-2 border-b border-zinc-200/80 dark:border-zinc-800/80">
      <div>
        <h2 class="text-lg sm:text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {{ $t('vmaf.title') }}
        </h2>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          Smart Probing & Dynamic Bisection CQ Optimization
        </p>
      </div>

      <div class="flex items-center space-x-2">
        <Badge variant="default">
          <span class="tabular-nums mr-1">{{ telemetryStore.queueStatus.probing }}</span> Probing
        </Badge>
        <Badge variant="warning">
          <span class="tabular-nums mr-1">{{ telemetryStore.queueStatus.encoding }}</span> Encoding
        </Badge>
      </div>
    </div>

    <!-- Savings Summary Metrics Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card class="p-4">
        <span class="text-xs font-medium text-zinc-500">{{ $t('vmaf.rawSize') }}</span>
        <div class="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mt-1 tabular-nums">
          {{ formatBytes(telemetryStore.savingsSummary.totalRawBytes) }}
        </div>
      </Card>

      <Card class="p-4">
        <span class="text-xs font-medium text-zinc-500">{{ $t('vmaf.compressedSize') }}</span>
        <div class="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mt-1 tabular-nums">
          {{ formatBytes(telemetryStore.savingsSummary.totalCompressedBytes) }}
        </div>
      </Card>

      <Card class="p-4 border-l-4 border-l-[#34C759]">
        <span class="text-xs font-medium text-zinc-500">{{ $t('vmaf.savingsPct') }}</span>
        <div class="text-xl sm:text-2xl font-bold tracking-tight text-[#34C759] mt-1 tabular-nums">
          {{ telemetryStore.savingsSummary.savingsPct.toFixed(1) }}%
        </div>
      </Card>
    </div>

    <!-- CQ vs VMAF Interactive Curve (SVG) -->
    <Card class="p-5">
      <CardTitle class="mb-1">{{ $t('vmaf.cqCurve') }}</CardTitle>
      <p class="text-xs text-zinc-500 mb-4">
        {{ $t('vmaf.targetGate') }}: VMAF 80.0 Mean (Horizontal Line)
      </p>

      <div class="w-full h-64 relative bg-zinc-50 dark:bg-[#121214] rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 p-2 overflow-hidden">
        <svg class="w-full h-full" viewBox="0 0 600 240" preserveAspectRatio="none">
          <!-- Grid lines -->
          <line x1="50" y1="30" x2="570" y2="30" stroke="rgba(150,150,150,0.15)" stroke-dasharray="4" />
          <line x1="50" y1="90" x2="570" y2="90" stroke="rgba(150,150,150,0.15)" stroke-dasharray="4" />
          <line x1="50" y1="150" x2="570" y2="150" stroke="rgba(150,150,150,0.15)" stroke-dasharray="4" />
          <line x1="50" y1="210" x2="570" y2="210" stroke="rgba(150,150,150,0.3)" />

          <!-- Target Gate Line (VMAF 80.0) -->
          <line x1="50" y1="78" x2="570" y2="78" stroke="#34C759" stroke-width="1.5" stroke-dasharray="6 3" />
          <text x="55" y="72" fill="#34C759" font-size="10" font-weight="600" class="tabular-nums">Target Gate (80.0)</text>

          <!-- Axis Labels -->
          <text x="15" y="34" fill="#888" font-size="10" class="tabular-nums">100</text>
          <text x="20" y="82" fill="#34C759" font-size="10" class="tabular-nums">80</text>
          <text x="20" y="154" fill="#888" font-size="10" class="tabular-nums">60</text>
          <text x="20" y="214" fill="#888" font-size="10" class="tabular-nums">40</text>

          <!-- CQ Points & Curve -->
          <polyline
            v-if="chartPoints.length > 1"
            :points="polylinePoints"
            fill="none"
            stroke="#007AFF"
            stroke-width="2"
          />

          <!-- Plotted Points -->
          <g v-for="(pt, idx) in chartPoints" :key="idx">
            <circle
              :cx="pt.x"
              :cy="pt.y"
              r="4.5"
              :fill="pt.gateMet ? '#34C759' : '#007AFF'"
              stroke="#FFFFFF"
              stroke-width="1.5"
            />
            <text :x="pt.x - 12" :y="pt.y - 8" fill="#666" font-size="10" font-weight="500" class="tabular-nums">
              CQ {{ pt.cq }} ({{ pt.vmaf.toFixed(1) }})
            </text>
          </g>
        </svg>
      </div>
    </Card>

    <!-- Live Probe Steps Table -->
    <Card class="overflow-hidden">
      <CardHeader>
        <CardTitle>{{ $t('vmaf.probeSteps') }}</CardTitle>
      </CardHeader>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
          <thead class="bg-zinc-50 dark:bg-zinc-900/60 font-semibold text-zinc-500">
            <tr>
              <th class="px-4 py-3">{{ $t('vmaf.iteration') }}</th>
              <th class="px-4 py-3">{{ $t('vmaf.recordingCol') }}</th>
              <th class="px-4 py-3">{{ $t('vmaf.testedCq') }}</th>
              <th class="px-4 py-3">{{ $t('vmaf.scoreMean') }}</th>
              <th class="px-4 py-3">{{ $t('vmaf.scoreP25') }}</th>
              <th class="px-4 py-3">{{ $t('vmaf.backend') }}</th>
              <th class="px-4 py-3">{{ $t('vmaf.duration') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/40 font-mono">
            <tr v-if="telemetryStore.probeSteps.length === 0">
              <td colspan="7" class="px-4 py-8 text-center text-zinc-400 font-sans">
                {{ $t('vmaf.emptyQueue') }}
              </td>
            </tr>
            <tr
              v-for="(step, idx) in telemetryStore.probeSteps"
              :key="idx"
              class="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors"
            >
              <td class="px-4 py-2.5 font-sans font-medium text-zinc-900 dark:text-zinc-100">
                #{{ step.iteration }}
              </td>
              <td class="px-4 py-2.5 tabular-nums text-zinc-600 dark:text-zinc-400">
                {{ step.recording_id }}
              </td>
              <td class="px-4 py-2.5 tabular-nums font-semibold text-[#007AFF]">
                CQ {{ step.cq }}
              </td>
              <td class="px-4 py-2.5 tabular-nums" :class="step.vmaf_mean >= 80 ? 'text-[#34C759]' : 'text-zinc-800 dark:text-zinc-200'">
                {{ step.vmaf_mean.toFixed(2) }}
              </td>
              <td class="px-4 py-2.5 tabular-nums text-zinc-600 dark:text-zinc-400">
                {{ step.vmaf_p25.toFixed(2) }}
              </td>
              <td class="px-4 py-2.5 font-sans">
                <Badge :variant="step.backend === 'cuda' ? 'success' : 'secondary'">
                  {{ step.backend.toUpperCase() }}
                </Badge>
              </td>
              <td class="px-4 py-2.5 tabular-nums text-zinc-500">
                {{ step.duration_ms }} ms
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import Card from "../components/ui/Card.vue";
import CardHeader from "../components/ui/CardHeader.vue";
import CardTitle from "../components/ui/CardTitle.vue";
import Badge from "../components/ui/Badge.vue";
import { useTelemetryStore } from "../stores/telemetry.js";

const telemetryStore = useTelemetryStore();

// Transform steps into SVG chart points
const chartPoints = computed(() => {
  const steps = [...telemetryStore.probeSteps].reverse().slice(-8);
  if (steps.length === 0) {
    // Default curve points for visual preview
    return [
      { x: 100, y: 50, cq: 24, vmaf: 92.5, gateMet: true },
      { x: 200, y: 68, cq: 28, vmaf: 87.0, gateMet: true },
      { x: 300, y: 78, cq: 32, vmaf: 83.2, gateMet: true },
      { x: 400, y: 110, cq: 36, vmaf: 76.8, gateMet: false },
      { x: 500, y: 160, cq: 40, vmaf: 68.0, gateMet: false },
    ];
  }

  const minX = 70;
  const maxX = 550;
  const stepX = (maxX - minX) / Math.max(1, steps.length - 1);

  return steps.map((s, i) => {
    // Map VMAF [40, 100] to Y [210, 30]
    const clampedVmaf = Math.max(40, Math.min(100, s.vmaf_mean));
    const y = 210 - ((clampedVmaf - 40) / 60) * 180;
    return {
      x: minX + i * stepX,
      y,
      cq: s.cq,
      vmaf: s.vmaf_mean,
      gateMet: s.vmaf_mean >= 80.0,
    };
  });
});

const polylinePoints = computed(() => {
  return chartPoints.value.map((p) => `${p.x},${p.y}`).join(" ");
});

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

onMounted(() => {
  telemetryStore.fetchStats();
});
</script>
