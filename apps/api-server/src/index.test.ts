import { describe, it, expect } from "vitest";
import { API_SERVER_VERSION, getHealthStatus } from "./index.js";

describe("API Server Skeleton", () => {
  it("exports correct version", () => {
    expect(API_SERVER_VERSION).toBe("1.0.0");
  });

  it("returns health status with ok", () => {
    const health = getHealthStatus();
    expect(health.status).toBe("ok");
    expect(health.timestamp).toBeDefined();
  });
});

