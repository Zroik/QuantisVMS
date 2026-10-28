<template>
  <span
    :class="[
      'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tracking-wide tabular-nums border',
      variantClasses[variant || 'default'],
    ]"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
defineProps<{
  variant?: "default" | "success" | "warning" | "destructive" | "secondary" | "outline";
}>();

const variantClasses = {
  default: "bg-blue-50 dark:bg-blue-950/40 text-[#007AFF] border-blue-200/50 dark:border-blue-900/50",
  success: "bg-green-50 dark:bg-green-950/40 text-[#34C759] border-green-200/50 dark:border-green-900/50",
  warning: "bg-amber-50 dark:bg-amber-950/40 text-[#FF9500] border-amber-200/50 dark:border-amber-900/50",
  destructive: "bg-red-50 dark:bg-red-950/40 text-[#FF3B30] border-red-200/50 dark:border-red-900/50",
  secondary: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200/80 dark:border-zinc-700/80",
  outline: "bg-transparent text-zinc-800 dark:text-zinc-200 border-zinc-300/80 dark:border-zinc-700/80",
};
</script>

