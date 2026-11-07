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

    it("uses exact center of the theme button as animation coordinate, not the mouse cursor position", async () => {
      const themeStore = useThemeStore();
      const mockButton = document.createElement("button");
      mockButton.id = "theme";
      mockButton.getBoundingClientRect = () => ({
        left: 20,
        top: 100,
        width: 44,
        height: 44,
        right: 64,
        bottom: 144,
        x: 20,
        y: 100,
        toJSON: () => {},
      });
      document.body.appendChild(mockButton);

      let capturedKeyframes: any = null;
      (document as any).documentElement.animate = (keyframes: any) => {
        capturedKeyframes = keyframes;
        return { onfinish: null };
      };

      (document as any).startViewTransition = (callback: () => void) => {
        callback();
        return {
          ready: Promise.resolve(),
          finished: Promise.resolve(),
        };
      };

      // Mouse clicked at offset corner (clientX: 25, clientY: 105) inside button
      const clickEvent = {
        currentTarget: mockButton,
        clientX: 25,
        clientY: 105,
      } as unknown as MouseEvent;

      themeStore.applyTheme("light");
      themeStore.toggleTheme(clickEvent);

      // Button center: left (20) + width/2 (22) = 42, top (100) + height/2 (22) = 122
      // Must use center 42px and 122px, NOT the cursor position 25px and 105px
      await Promise.resolve();
      expect(capturedKeyframes).toBeTruthy();
      expect(capturedKeyframes.clipPath[0]).toContain("42px 122px");
      expect(capturedKeyframes.clipPath[1]).toContain("42px 122px");

      document.body.removeChild(mockButton);
      delete (document as any).startViewTransition;
    });
  });

  describe("Auth Store (Spec §5)", () => {
    it("keeps access token strictly in memory and clears auth state on logout", async () => {
      const authStore = useAuthStore();
      authStore.token = "in-memory-access-token";
      expect(authStore.isAuthenticated).toBe(true);
      expect(localStorage.length).toBe(0);

      await authStore.logout();

      expect(authStore.token).toBeNull();
      expect(authStore.isAuthenticated).toBe(false);
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

