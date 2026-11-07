import { describe, it, expect, vi } from "vitest";

// The route table is the contract under test. Stub the SFCs so the test does not
// pull in template asset URLs or view dependencies.
vi.mock("./components/AppLayout.vue", () => ({ default: { name: "AppLayout" } }));
vi.mock("./views/LoginView.vue", () => ({ default: { name: "LoginView" } }));
vi.mock("./views/LiveMatrixView.vue", () => ({ default: { name: "LiveMatrixView" } }));
vi.mock("./views/TimelineView.vue", () => ({ default: { name: "TimelineView" } }));
vi.mock("./views/HardwareMonitorView.vue", () => ({ default: { name: "HardwareMonitorView" } }));
vi.mock("./views/ConfigurationView.vue", () => ({ default: { name: "ConfigurationView" } }));

const { routes } = await import("./router/index.js");

const layoutRoute = routes.find((route) => route.path === "/");
const children = layoutRoute?.children ?? [];
const child = (path: string) => children.find((route) => route.path === path);

describe("Dashboard routing (clean restructure)", () => {
  it("registers the renamed primary views", () => {
    expect(child("live")?.name).toBe("live");
    expect(child("playback")?.name).toBe("playback");
    expect(child("monitor")?.name).toBe("monitor");
    expect(child("configuration")?.name).toBe("configuration");
  });

  it("redirects every legacy path to its new location", () => {
    expect(child("")?.redirect).toBe("/live");
    expect(child("matrix")?.redirect).toBe("/live");
    expect(child("timeline")?.redirect).toBe("/playback");
    expect(child("hardware")?.redirect).toBe("/monitor");
    expect(child("settings")?.redirect).toBe("/configuration");
  });

  it("retires the VMAF telemetry route but keeps a permanent redirect", () => {
    expect(child("vmaf")?.redirect).toBe("/live");
    expect(child("vmaf")?.component).toBeUndefined();
    expect(children.some((route) => route.name === "vmaf")).toBe(false);
  });

  it("sends unknown paths to the live view", () => {
    const fallback = routes.find((route) => route.path === "/:pathMatch(.*)*");
    expect(fallback?.redirect).toBe("/live");
  });
});
