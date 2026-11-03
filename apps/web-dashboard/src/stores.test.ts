import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useThemeStore } from "./stores/theme.js";
import { useAuthStore } from "./stores/auth.js";
import { useTelemetryStore } from "./stores/telemetry.js";
import { normalizeDetectionBox } from "./stores/socket.js";

describe("Pinia Dashboard Stores", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  describe("Theme Store (Spec §11 - Light/Dark & Manual Toggle)", () => {
    it("toggles between light and dark modes and persists to localStorage", () => {
      const themeStore = useThemeStore();
      themeStore.applyTheme("light");
      expect(themeStore.theme).toBe("light");
      expect(localStorage.getItem("vms_theme")).toBe("light");

      themeStore.toggleTheme();
      expect(themeStore.theme).toBe("dark");
      expect(localStorage.getItem("vms_theme")).toBe("dark");

      themeStore.toggleTheme();
      expect(themeStore.theme).toBe("light");
    });
  });

  describe("Auth Store (Spec §5)", () => {
    it("clears auth tokens on logout", async () => {
      const authStore = useAuthStore();
      localStorage.setItem("vms_access_token", "fake-token");
      await authStore.logout();

      expect(authStore.token).toBeNull();
      expect(authStore.isAuthenticated).toBe(false);
      expect(localStorage.getItem("vms_access_token")).toBeNull();
    });
  });

  describe("Socket detection wire contract", () => {
    it("normalizes the worker's {cls,conf,x1..y2} payload into the overlay shape", () => {
      const box = normalizeDetectionBox({ cls: 0, conf: 0.91, x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 });
      expect(box).toEqual({
        bbox: [0.1, 0.2, 0.3, 0.4],
        confidence: 0.91,
        class_id: 0,
        class_name: "person",
      });
    });

    it("drops malformed boxes instead of rendering undefined", () => {
      expect(normalizeDetectionBox({ cls: 0, conf: 0.9 })).toBeNull();
    });
  });

  describe("Telemetry Store (Spec §8)", () => {
    it("adds and buffers probe steps with FIFO cap", () => {
      const telemetryStore = useTelemetryStore();
      expect(telemetryStore.probeSteps.length).toBe(0);

      telemetryStore.addProbeStep({
        recording_id: 1,
        chunk_index: 0,
        iteration: 1,
        cq: 32,
        vmaf_mean: 84.5,
        vmaf_p25: 80.2,
        backend: "cuda",
        duration_ms: 120,
      });

      expect(telemetryStore.probeSteps.length).toBe(1);
      expect(telemetryStore.probeSteps[0].cq).toBe(32);
      expect(telemetryStore.probeSteps[0].vmaf_mean).toBe(84.5);
      expect(telemetryStore.probeSteps[0].received_at).toBeDefined();
    });
  });
});

