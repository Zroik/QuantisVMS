import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

const fetchCameras = vi.fn().mockResolvedValue(undefined);
const fetchConfig = vi.fn().mockResolvedValue(undefined);

vi.mock("../stores/cameras.js", () => ({
  useCamerasStore: () => ({ cameras: [], fetchCameras }),
}));

vi.mock("../stores/auth.js", () => ({
  useAuthStore: () => ({ token: null }),
}));

vi.mock("../stores/config.js", () => ({
  useConfigStore: () => ({ config: null, fetchConfig }),
}));

vi.mock("../services/api.js", () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
}));

const TimelineView = (await import("./TimelineView.vue")).default;

function mountPlayback() {
  return mount(TimelineView, {
    global: {
      stubs: {
        RouterLink: { template: "<a><slot /></a>" },
      },
    },
  });
}

describe("Playback zero-camera state", () => {
  it("shows the empty-state banner pointing at Configuration", async () => {
    const wrapper = mountPlayback();
    await Promise.resolve();

    const banner = wrapper.find(".empty-banner");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("Belum ada kamera terhubung");
    expect(banner.text()).toContain("Konfigurasi");

    wrapper.unmount();
  });

  it("disables the camera selector and the player controls", async () => {
    const wrapper = mountPlayback();
    await Promise.resolve();

    expect(wrapper.find("select.sel").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".video-empty-state").text()).toContain("Belum ada kamera terhubung");

    const playButton = wrapper.findAll(".bardeck-controls button").find((button) =>
      button.text().includes("Putar")
    );
    expect(playButton?.attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  it("does not request recordings without a selected camera", async () => {
    const wrapper = mountPlayback();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchCameras).toHaveBeenCalled();
    // The selector falls back to id 0, so no /api/recordings request is issued.
    const { apiFetch } = await import("../services/api.js");
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();

    wrapper.unmount();
  });
});
