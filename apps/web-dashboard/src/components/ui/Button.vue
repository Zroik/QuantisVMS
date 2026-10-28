<template>
  <button
    :type="type || 'button'"
    :disabled="disabled || loading"
    :class="[
      'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none rounded-lg text-sm px-3.5 py-1.5 cursor-pointer',
      variantClasses[variant || 'default'],
    ]"
  >
    <span v-if="loading" class="inline-block mr-1.5 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
    <slot />
  </button>
</template>

<script setup lang="ts">
const props = defineProps<{
  type?: "button" | "submit" | "reset";
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive" | "success";
  disabled?: boolean;
  loading?: boolean;
}>();

const variantClasses = {
  default: "bg-[#007AFF] text-white hover:bg-blue-600 active:bg-blue-700 shadow-xs",
  secondary: "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700",
  outline: "border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#1C1C1E] text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 shadow-xs",
  ghost: "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60",
  destructive: "bg-[#FF3B30] text-white hover:bg-red-600 active:bg-red-700 shadow-xs",
  success: "bg-[#34C759] text-white hover:bg-green-600 active:bg-green-700 shadow-xs",
};
</script>

