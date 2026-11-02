import { describe, it, expect } from "vitest";
import { WEB_DASHBOARD_VERSION, getAppTitle } from "./app.js";

describe("Web Dashboard Skeleton", () => {
  it("exports correct version", () => {
    expect(WEB_DASHBOARD_VERSION).toBe("1.0.0");
  });

  it("returns app title", () => {
    expect(getAppTitle()).toBe("Quantis Dashboard");
  });
});

