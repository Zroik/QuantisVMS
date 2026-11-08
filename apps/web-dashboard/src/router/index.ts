import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AppLayout from "../components/AppLayout.vue";
// Views are lazy-loaded so a first visit to /login does not download the whole
// dashboard bundle (configuration, timeline, hardware, hls.js).
const LoginView = () => import("../views/LoginView.vue");
const LiveMatrixView = () => import("../views/LiveMatrixView.vue");
const TimelineView = () => import("../views/TimelineView.vue");
const HardwareMonitorView = () => import("../views/HardwareMonitorView.vue");
const ConfigurationView = () => import("../views/ConfigurationView.vue");
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
