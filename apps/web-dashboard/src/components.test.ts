import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Switch from "./components/ui/Switch.vue";
import BboxOverlay from "./components/BboxOverlay.vue";
import Badge from "./components/ui/Badge.vue";
import { i18nPlugin } from "./i18n/index.js";

describe("Frontend UI Components (Gate G5.1)", () => {
  describe("Switch Component (Reka UI Pill)", () => {
    it("renders unchecked state properly and emits update:modelValue", async () => {
      const wrapper = mount(Switch, {
        props: {
          modelValue: false,
          ariaLabel: "Test Switch",
        },
      });

      expect(wrapper.find("button").exists()).toBe(true);
      await wrapper.find("button").trigger("click");
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Badge Component", () => {
    it("renders success variant with tabular-nums", () => {
      const wrapper = mount(Badge, {
        props: { variant: "success" },
        slots: { default: "95.5%" },
      });

      expect(wrapper.text()).toBe("95.5%");
      expect(wrapper.classes()).toContain("tabular-nums");
    });
  });

  describe("BboxOverlay Component (Spec §11)", () => {
    it("renders HLS disabled badge when isHls is true", () => {
      const wrapper = mount(BboxOverlay, {
        props: {
          boxes: [],
          isHls: true,
        },
        global: {
          plugins: [i18nPlugin],
        },
      });

      expect(wrapper.text()).toContain("Deteksi AI nonaktif");
    });

    it("renders SVG layer when isHls is false", () => {
      const wrapper = mount(BboxOverlay, {
        props: {
          boxes: [
            {
              bbox: [0.1, 0.1, 0.5, 0.5],
              confidence: 0.92,
              class_id: 0,
              class_name: "person",
            },
          ],
          lastUpdated: Date.now(),
          isHls: false,
        },
        global: {
          plugins: [i18nPlugin],
        },
      });

      expect(wrapper.find("svg").exists()).toBe(true);
    });
  });
});

