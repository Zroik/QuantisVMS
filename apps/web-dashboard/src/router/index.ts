import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AppLayout from "../components/AppLayout.vue";
import LoginView from "../views/LoginView.vue";
import LiveMatrixView from "../views/LiveMatrixView.vue";
import TimelineView from "../views/TimelineView.vue";
import HardwareMonitorView from "../views/HardwareMonitorView.vue";
import ConfigurationView from "../views/ConfigurationView.vue";
import { useAuthStore } from "../stores/auth.js";

export const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "login",
    component: LoginView,
    meta: { guestOnly: true },
  },
  {
    path: "/",
    component: AppLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: "",
        redirect: "/live",
      },
      {
        path: "live",
        name: "live",
        component: LiveMatrixView,
      },
      {
        path: "matrix",
        redirect: "/live",
      },
      {
        path: "playback",
        name: "playback",
        component: TimelineView,
      },
      {
        path: "timeline",
        redirect: "/playback",
      },
      {
        path: "monitor",
        name: "monitor",
        component: HardwareMonitorView,
      },
      {
        path: "hardware",
        redirect: "/monitor",
      },
      {
        path: "vmaf",
        redirect: "/live",
      },
      {
        path: "configuration",
        name: "configuration",
        component: ConfigurationView,
      },
      {
        path: "settings",
        redirect: "/configuration",
      },
    ],
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/live",
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();
  if (!authStore.token) {
    await authStore.refreshAccessToken();
  }

  if (to.meta.requiresAuth) {
    if (!authStore.token) {
      return next({ name: "login" });
    }
    if (!authStore.user) {
      const ok = await authStore.fetchCurrentUser();
      if (!ok) {
        authStore.clearAuth();
        return next({ name: "login" });
      }
    }
    return next();
  }

  if (to.meta.guestOnly && authStore.token) {
    return next({ name: "live" });
  }

  next();
});
