import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { getDbPool, closeDbPool } from "../db/connection.js";
import { hashPassword, generateTokens } from "../auth/service.js";

describe("Gate G3.9: MediaMTX Auth Hook (Spec §6.4 & §9.6, Gate G3.9)", () => {
  const app = createApp();
  const pool = getDbPool();

  let validToken: string;
  const testUser = {
    username: "mediamtx_test_user",
    password: "MediaMtxPass123!",
  };

  beforeAll(async () => {
    await pool.query("DELETE FROM users WHERE username = ?", [testUser.username]);
    const hashed = await hashPassword(testUser.password);
    const [userRes] = await pool.query<any>(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'viewer')",
      [testUser.username, hashed]
    );
    const tokens = await generateTokens({
      userId: userRes.insertId,
      username: testUser.username,
      role: "viewer",
    });
    validToken = tokens.accessToken;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM users WHERE username = ?", [testUser.username]);
    await closeDbPool();
  });

  it("item 1: unauthenticated read request is rejected with 401 Unauthorized", async () => {
    const res = await request(app)
      .post("/internal/mediamtx/auth")
      .send({
        ip: "192.168.1.50",
        action: "read",
        path: "cam1",
        protocol: "rtsp",
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Authentication required");
  });

  it("item 2: read request with invalid credentials is rejected with 401 Unauthorized", async () => {
    const res = await request(app)
      .post("/internal/mediamtx/auth")
      .send({
        ip: "192.168.1.50",
        user: testUser.username,
        password: "WrongPassword999",
        action: "read",
        path: "cam1",
        protocol: "rtsp",
      });

    expect(res.status).toBe(401);
  });

  it("item 3: read request with valid user credentials is accepted with 200 OK", async () => {
    const res = await request(app)
      .post("/internal/mediamtx/auth")
      .send({
        ip: "192.168.1.50",
        user: testUser.username,
        password: testUser.password,
        action: "read",
        path: "cam1",
        protocol: "rtsp",
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("item 4: read request with valid JWT token in query is accepted with 200 OK", async () => {
    const res = await request(app)
      .post("/internal/mediamtx/auth")
      .send({
        ip: "192.168.1.50",
        action: "read",
        path: "cam1",
        protocol: "webrtc",
        query: `jwt=${validToken}`,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("item 5: publish request with internal auth secret is accepted with 200 OK", async () => {
    const res = await request(app)
      .post("/internal/mediamtx/auth")
      .send({
        ip: "127.0.0.1",
        action: "publish",
        path: "cam1",
        protocol: "rtsp",
        password: process.env.MEDIAMTX_AUTH_SECRET || "mediamtx_internal_token_secret",
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

