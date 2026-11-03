<template>
  <div class="shell">
    <!-- Desktop Pinned Floating Sidebar Dock -->
    <aside class="side">
      <div class="dock">
        <!-- Brand Lockup -->
        <router-link :to="{ name: 'matrix' }" class="brand" title="Quantis">
          <img src="/quantis-symbol.png" alt="Quantis" class="mark" />
          <div class="brand-info">
            <b>Quantis</b>
            <small>{{ i18n.t('nav.brandSub') }}</small>
          </div>
        </router-link>

        <!-- Sidebar Navigation Links -->
        <nav class="nav" :aria-label="i18n.t('nav.mainNavAria')">
          <router-link
            :to="{ name: 'matrix' }"
            :title="i18n.t('nav.liveMatrix')"
          >
            <svg viewBox="0 0 24 24">
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
            </svg>
            <span>{{ i18n.t('nav.liveMatrix') }}</span>
            <i>{{ activeCameraCount }}</i>
          </router-link>

          <router-link
            :to="{ name: 'vmaf' }"
            :title="i18n.t('nav.vmafTelemetry')"
          >
            <svg viewBox="0 0 24 24">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <span>{{ i18n.t('nav.vmafTelemetry') }}</span>
          </router-link>

          <router-link
            :to="{ name: 'timeline' }"
            :title="i18n.t('nav.timeline')"
          >
            <svg viewBox="0 0 24 24">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2" />
            </svg>
            <span>{{ i18n.t('nav.timeline') }}</span>
          </router-link>

          <router-link
            :to="{ name: 'hardware' }"
            :title="i18n.t('nav.hardware')"
          >
            <svg viewBox="0 0 24 24">
              <path d="M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
            </svg>
            <span>{{ i18n.t('nav.hardware') }}</span>
          </router-link>

          <router-link
            :to="{ name: 'configuration' }"
            :title="i18n.t('nav.configuration')"
          >
            <svg viewBox="0 0 24 24">
              <path d="M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
            </svg>
            <span>{{ i18n.t('nav.configuration') }}</span>
          </router-link>
        </nav>

        <!-- Bottom Tools (Language, Theme, Logout) -->
        <div class="tools">
          <button
            class="tb id"
            type="button"
            @click="toggleLang"
            :title="i18n.t('nav.lang')"
          >
            {{ i18n.locale.value.toUpperCase() }}
          </button>

          <button
            class="tb"
            type="button"
            id="theme"
            @click="themeStore.toggleTheme"
            :title="i18n.t('nav.theme')"
            :aria-label="i18n.t('nav.theme')"
          >
            <transition name="theme-icon" mode="out-in">
              <svg v-if="themeStore.theme === 'dark'" key="dark" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
              </svg>
              <svg v-else key="light" viewBox="0 0 24 24">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            </transition>
          </button>

          <button
            class="tb out"
            type="button"
            @click="handleLogout"
            :title="i18n.t('nav.logout')"
            :aria-label="i18n.t('nav.logout')"
          >
            <svg viewBox="0 0 24 24">
              <path d="m16 17 5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            </svg>
            <span>{{ i18n.t('nav.logout') }}</span>
          </button>
        </div>
      </div>
    </aside>

    <!-- Main View Independent Scroll Container -->
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { useThemeStore } from "../stores/theme.js";
import { useSocketStore } from "../stores/socket.js";
import { useCamerasStore } from "../stores/cameras.js";
import { useI18n, type SupportedLocale } from "../i18n/index.js";

const router = useRouter();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const socketStore = useSocketStore();
const camerasStore = useCamerasStore();
const i18n = useI18n();

const activeCameraCount = computed(() => {
  return camerasStore.cameras?.filter((c) => c.enabled !== false).length ?? 0;
});

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
  camerasStore.fetchCameras().catch(() => {});
});

onUnmounted(() => {
  socketStore.disconnect();
});
</script>

<style scoped>
/* App Shell Grid with Strict Scroll Isolation */
.shell {
  display: grid;
  grid-template-columns: 268px minmax(0, 1fr);
  height: 100vh;
  height: 100dvh;
  max-width: 100vw;
  overflow: hidden;
  background: var(--bg);
}

/* Floating Sidebar Rail */
.side {
  position: relative;
  height: 100vh;
  height: 100dvh;
  padding: 12px 0 12px 12px;
  z-index: 30;
  flex-shrink: 0;
}

/* Floating Dark Dock Container */
.dock {
  height: 100%;
  padding: 16px 12px 12px;
  background: var(--dock);
  color: var(--on-dock);
  border-radius: 28px;
  box-shadow: 0 20px 40px -18px rgba(10, 20, 30, 0.45), 0 0 0 1px var(--rim);
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}

.dock::-webkit-scrollbar {
  display: none;
}

/* Brand Lockup */
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 8px;
  text-decoration: none;
  color: inherit;
  transition: opacity .15s ease;
}

.brand:hover {
  opacity: .9;
}

.mark {
  width: 38px;
  height: 38px;
  object-fit: contain;
  flex-shrink: 0;
  border-radius: 8px;
}

.brand-info {
  display: grid;
  line-height: 1.15;
}

.brand-info b {
  font-size: var(--fs-xl);
  font-weight: 700;
  letter-spacing: -.02em;
  color: var(--on-dock);
}

.brand-info small {
  font-size: var(--fs-xs);
  font-weight: 600;
  opacity: .62;
  white-space: nowrap;
  color: var(--on-dock);
}

/* Nav Links */
.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.nav button,
.nav a {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 18px;
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  opacity: .74;
  text-align: left;
  color: var(--on-dock);
  text-decoration: none;
  transition: opacity .15s, background-color .15s, color .15s, transform .12s;
  width: 100%;
}

.nav button:hover,
.nav a:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.13);
}

.nav button:active,
.nav a:active {
  transform: scale(.97);
}

.nav button[aria-current="page"],
.nav a[aria-current="page"] {
  opacity: 1;
  background: var(--on-dock);
  color: var(--dock);
}

.nav button svg,
.nav a svg {
  display: block;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
}

.nav i {
  margin-left: auto;
  font: 700 var(--fs-xs)/18px var(--f);
  min-width: 18px;
  height: 18px;
  text-align: center;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.18);
  color: var(--on-dock);
  font-style: normal;
  padding: 0 5px;
}

.nav button[aria-current="page"] i {
  background: rgba(17, 17, 17, 0.12);
  color: var(--dock);
}

/* Bottom Tools */
.tools {
  display: flex;
  gap: 6px;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
}

.tb {
  min-width: 44px;
  height: 44px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .04em;
  opacity: .74;
  color: var(--on-dock);
  transition: opacity .15s, background-color .15s, transform .12s;
}

.tb:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.13);
}

.tb:active {
  transform: scale(.96);
}

.tb svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Tactile Spring Rotation for Theme Switch Icon */
.theme-icon-enter-active,
.theme-icon-leave-active {
  transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
}

.theme-icon-enter-from {
  transform: rotate(-90deg) scale(0.4);
  opacity: 0;
}

.theme-icon-leave-to {
  transform: rotate(90deg) scale(0.4);
  opacity: 0;
}

.tb.out {
  margin-left: auto;
  letter-spacing: 0;
  font-size: var(--fs-md);
  font-weight: 600;
}

/* Main Content Area: Independent Scroll */
.main-content {
  height: 100vh;
  height: 100dvh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0;
  -webkit-overflow-scrolling: touch;
}

/* Mobile Bottom Pill Navigation */
@media (max-width: 860px) {
  .shell {
    grid-template-columns: 1fr;
  }
  .side {
    position: fixed;
    inset: auto 0 calc(12px + env(safe-area-inset-bottom, 0px)) 0;
    height: auto;
    padding: 0;
    display: flex;
    justify-content: center;
    pointer-events: none;
    z-index: 50;
  }
  .dock {
    height: auto;
    pointer-events: auto;
    flex-direction: row;
    gap: 4px;
    padding: 6px;
    border-radius: 999px;
    max-width: calc(100vw - 24px);
    overflow: visible;
  }
  .brand, .nav i, .tb.out span, .tb.id {
    display: none;
  }
  .nav span {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .nav {
    flex-direction: row;
    gap: 2px;
    flex: none;
  }
  .nav button,
  .nav a {
    width: 44px;
    padding: 0;
    justify-content: center;
    border-radius: 999px;
    position: relative;
  }
  .tools {
    padding: 0 0 0 6px;
    border-top: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.16);
    margin-left: 2px;
  }
  .tb.out {
    margin: 0;
  }
  .main-content {
    padding-bottom: calc(90px + env(safe-area-inset-bottom, 0px));
  }
}
</style>
