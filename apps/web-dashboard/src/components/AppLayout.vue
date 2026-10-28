<template>
  <div class="min-h-screen flex flex-col bg-[#F5F5F7] dark:bg-[#000000] text-zinc-900 dark:text-zinc-100">
    <!-- Top Navigation Bar -->
    <header class="sticky top-0 z-40 w-full border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/95 dark:bg-[#1C1C1E]/95 shadow-xs">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <!-- Logo & Brand -->
        <div class="flex items-center space-x-6">
          <router-link :to="{ name: 'matrix' }" aria-label="Smart VMS" class="flex items-center space-x-2.5 font-bold tracking-tight text-base sm:text-lg">
            <span class="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#007AFF] text-white shadow-xs">
              <Video class="h-4 w-4" />
            </span>
            <span class="hidden sm:inline-block">Smart VMS</span>
          </router-link>

          <!-- Nav Links -->
          <nav class="hidden md:flex items-center space-x-1 text-sm font-medium">
            <router-link
              :to="{ name: 'matrix' }"
              active-class="bg-zinc-100 dark:bg-zinc-800 text-[#007AFF] dark:text-[#007AFF]"
              class="px-3 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              {{ $t('nav.liveMatrix') }}
            </router-link>
            <router-link
              :to="{ name: 'vmaf' }"
              active-class="bg-zinc-100 dark:bg-zinc-800 text-[#007AFF] dark:text-[#007AFF]"
              class="px-3 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              {{ $t('nav.vmafTelemetry') }}
            </router-link>
            <router-link
              :to="{ name: 'timeline' }"
              active-class="bg-zinc-100 dark:bg-zinc-800 text-[#007AFF] dark:text-[#007AFF]"
              class="px-3 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              {{ $t('nav.timeline') }}
            </router-link>
            <router-link
              :to="{ name: 'hardware' }"
              active-class="bg-zinc-100 dark:bg-zinc-800 text-[#007AFF] dark:text-[#007AFF]"
              class="px-3 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              {{ $t('nav.hardware') }}
            </router-link>
            <router-link
              :to="{ name: 'settings' }"
              active-class="bg-zinc-100 dark:bg-zinc-800 text-[#007AFF] dark:text-[#007AFF]"
              class="px-3 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              {{ $t('nav.settings') }}
            </router-link>
          </nav>
        </div>

        <!-- Right Side Controls (Theme, Language, Logout) -->
        <div class="flex items-center space-x-2 sm:space-x-3">
          <!-- Socket Connection Indicator -->
          <span
            class="h-2 w-2 rounded-full"
            :class="socketStore.isConnected ? 'bg-[#34C759]' : 'bg-[#FF3B30]'"
            :title="socketStore.isConnected ? 'Socket Online' : 'Socket Reconnecting'"
          ></span>

          <!-- Language Selector -->
          <button
            type="button"
            @click="toggleLang"
            class="px-2 py-1 text-xs font-semibold uppercase rounded-md border border-zinc-200/80 dark:border-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            :title="$t('nav.lang')"
            :aria-label="i18n.locale.value"
          >
            {{ i18n.locale.value }}
          </button>

          <!-- Theme Toggle -->
          <button
            type="button"
            @click="themeStore.toggleTheme"
            class="p-1.5 rounded-md text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            :title="$t('nav.theme')"
            :aria-label="$t('nav.theme')"
          >
            <Sun v-if="themeStore.theme === 'dark'" class="h-4 w-4" />
            <Moon v-else class="h-4 w-4" />
          </button>

          <!-- Sign Out -->
          <Button variant="ghost" size="sm" @click="handleLogout" class="text-xs">
            <LogOut class="h-3.5 w-3.5 mr-1" />
            <span class="hidden sm:inline">{{ $t('nav.logout') }}</span>
          </Button>
        </div>
      </div>
    </header>

    <!-- Main View Content Container -->
    <main class="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 pb-16 md:pb-6">
      <router-view />
    </main>

    <!-- Mobile Bottom Navigation Bar (Responsive down to 360px) -->
    <nav aria-label="Mobile Navigation" class="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#1C1C1E]/95 border-t border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-around py-1.5 px-2 shadow-xs">
      <router-link
        :to="{ name: 'matrix' }"
        aria-label="Matriks Kamera"
        active-class="text-[#007AFF] font-bold"
        class="flex flex-col items-center justify-center p-1 text-[10px] text-zinc-600 dark:text-zinc-400 min-h-[44px] min-w-[44px]"
      >
        <Video class="h-4 w-4 mb-0.5" />
        <span>Matrix</span>
      </router-link>

      <router-link
        :to="{ name: 'vmaf' }"
        aria-label="Telemetri VMAF"
        active-class="text-[#007AFF] font-bold"
        class="flex flex-col items-center justify-center p-1 text-[10px] text-zinc-600 dark:text-zinc-400 min-h-[44px] min-w-[44px]"
      >
        <Activity class="h-4 w-4 mb-0.5" />
        <span>VMAF</span>
      </router-link>

      <router-link
        :to="{ name: 'timeline' }"
        aria-label="Garis Waktu Forensik"
        active-class="text-[#007AFF] font-bold"
        class="flex flex-col items-center justify-center p-1 text-[10px] text-zinc-600 dark:text-zinc-400 min-h-[44px] min-w-[44px]"
      >
        <Clock class="h-4 w-4 mb-0.5" />
        <span>Timeline</span>
      </router-link>

      <router-link
        :to="{ name: 'hardware' }"
        aria-label="Monitor Perangkat Keras"
        active-class="text-[#007AFF] font-bold"
        class="flex flex-col items-center justify-center p-1 text-[10px] text-zinc-600 dark:text-zinc-400 min-h-[44px] min-w-[44px]"
      >
        <Cpu class="h-4 w-4 mb-0.5" />
        <span>Hardware</span>
      </router-link>

      <router-link
        :to="{ name: 'settings' }"
        aria-label="Pengaturan"
        active-class="text-[#007AFF] font-bold"
        class="flex flex-col items-center justify-center p-1 text-[10px] text-zinc-600 dark:text-zinc-400 min-h-[44px] min-w-[44px]"
      >
        <Settings class="h-4 w-4 mb-0.5" />
        <span>Settings</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { Video, Sun, Moon, LogOut, Activity, Clock, Cpu, Settings } from "lucide-vue-next";
import Button from "./ui/Button.vue";
import { useAuthStore } from "../stores/auth.js";
import { useThemeStore } from "../stores/theme.js";
import { useSocketStore } from "../stores/socket.js";
import { useI18n, type SupportedLocale } from "../i18n/index.js";

const router = useRouter();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const socketStore = useSocketStore();
const i18n = useI18n();

const toggleLang = () => {
  const next: SupportedLocale = i18n.locale.value === "id" ? "en" : "id";
  i18n.setLocale(next);
};

const handleLogout = async () => {
  await authStore.logout();
  socketStore.disconnect();
  router.push({ name: "login" });
};

onMounted(() => {
  socketStore.connect();
});

onUnmounted(() => {
  socketStore.disconnect();
});
</script>
