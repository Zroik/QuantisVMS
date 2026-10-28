import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import AppLayout from "../components/AppLayout.vue";
import LoginView from "../views/LoginView.vue";
import LiveMatrixView from "../views/LiveMatrixView.vue";
import VmafTelemetryView from "../views/VmafTelemetryView.vue";
import TimelineView from "../views/TimelineView.vue";
import HardwareMonitorView from "../views/HardwareMonitorView.vue";
import SettingsView from "../views/SettingsView.vue";

const routes: RouteRecordRaw[] = [
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
        redirect: "/matrix",
      },
      {
        path: "matrix",
        name: "matrix",
        component: LiveMatrixView,
      },
      {
        path: "vmaf",
        name: "vmaf",
        component: VmafTelemetryView,
      },
      {
        path: "timeline",
        name: "timeline",
        component: TimelineView,
      },
      {
        path: "hardware",
        name: "hardware",
        component: HardwareMonitorView,
      },
      {
        path: "settings",
        name: "settings",
        component: SettingsView,
      },
    ],
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/matrix",
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem("vms_access_token");

  if (to.meta.requiresAuth && !token) {
    next({ name: "login" });
  } else if (to.meta.guestOnly && token) {
    next({ name: "matrix" });
  } else {
    next();
  }
});

