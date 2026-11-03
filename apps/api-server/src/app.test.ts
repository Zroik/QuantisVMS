import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("App routing (V-R1 regression guard)", () => {
  const app = createApp();

  it("boots without throwing on Express 5 path syntax", () => {
    expect(app).toBeDefined();
  });

  it("answers /healthz", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns JSON 404 for unknown /api routes", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Endpoint not found" });
  });

  it("still routes known /api endpoints before the catch-all", async () => {
    const res = await request(app).get("/api/cameras");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication/i);
  });
});
