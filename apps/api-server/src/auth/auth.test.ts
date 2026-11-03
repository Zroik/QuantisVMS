import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { getDbPool, closeDbPool } from "../db/connection.js";
import { getRedisClient, closeRedisClients } from "../redis/client.js";
import { hashPassword } from "./service.js";

describe("Gate G3.2: Auth Matrix (Spec §6.4 & §7, Gate G3.2)", () => {
  const app = createApp();
  const pool = getDbPool();
  const redis = getRedisClient();

  const testUser = {
    username: "test_g32_admin",
    password: "CorrectHorseBatteryStaple!123",
    role: "admin",
  };
  let userId: number;

  beforeAll(async () => {
    // Clean up test data and rate limiter keys
    await pool.query("DELETE FROM users WHERE username = ?", [testUser.username]);
    const keys = await redis.keys("ratelimit:login:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    const hashed = await hashPassword(testUser.password);
    const [result] = await pool.query<any>(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
      [testUser.username, hashed, testUser.role]
    );
    userId = result.insertId;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM users WHERE username = ?", [testUser.username]);
    await closeDbPool();
    await closeRedisClients();
  });

  it("matrix item 1: successful login with valid credentials (200 OK)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: testUser.username, password: testUser.password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined();
    const cookies = (res.headers["set-cookie"] as unknown as string[]) || [];
    expect(cookies.some((c: string) => c.startsWith("refreshToken="))).toBe(true);
    expect(res.body.user).toEqual({
      id: userId,
      username: testUser.username,
      role: testUser.role,
    });
  });

  it("matrix item 2: wrong password returns 401 Unauthorized", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: testUser.username, password: "WrongPassword999!" });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Invalid username or password");
  });

  it("matrix item 3: protected route without token returns 401 Unauthorized", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("matrix item 4: protected route with valid token returns 200 OK and user payload", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: testUser.username, password: testUser.password });

    const token = loginRes.body.accessToken;

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.username).toBe(testUser.username);
    expect(meRes.body.user.role).toBe(testUser.role);
  });

  it("matrix item 5: refresh token rotation (single-use enforced, successive rotation works, reuse rejected 401)", async () => {
    const agent = request.agent(app);
    const loginRes = await agent
      .post("/api/auth/login")
      .send({ username: testUser.username, password: testUser.password });

    expect(loginRes.status).toBe(200);
    const cookieA = ((loginRes.headers["set-cookie"] as unknown as string[]) || []).find((c: string) => c.startsWith("refreshToken="));
    expect(cookieA).toBeDefined();

    const refreshRes1 = await agent.post("/api/auth/refresh");
    expect(refreshRes1.status).toBe(200);
    expect(refreshRes1.body.accessToken).toBeDefined();
    const cookieB = ((refreshRes1.headers["set-cookie"] as unknown as string[]) || []).find((c: string) => c.startsWith("refreshToken="));
    expect(cookieB).toBeDefined();
    expect(cookieB).not.toBe(cookieA);

    const refreshRes2 = await agent.post("/api/auth/refresh");
    expect(refreshRes2.status).toBe(200);
    const cookieC = ((refreshRes2.headers["set-cookie"] as unknown as string[]) || []).find((c: string) => c.startsWith("refreshToken="));
    expect(cookieC).toBeDefined();
    expect(cookieC).not.toBe(cookieB);

    // Reusing the first cookie must be rejected and revoke the family.
    const reuseRes = await request(app).post("/api/auth/refresh").set("Cookie", cookieA!);
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error).toContain("already used or revoked");

    const revokedRes = await request(app).post("/api/auth/refresh").set("Cookie", cookieC!);
    expect(revokedRes.status).toBe(401);
  });

  it("matrix item 6: rate-limit triggers 429 after exceeding limit (5 attempts)", async () => {
    // Clear rate limit first
    const keys = await redis.keys("ratelimit:login:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    // 5 attempts within window -> all 401 (invalid password)
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: testUser.username, password: "WrongPassword" });
      expect(res.status).toBe(401);
    }

    // 6th attempt must be rejected with 429 Too Many Requests
    const blockedRes = await request(app)
      .post("/api/auth/login")
      .send({ username: testUser.username, password: testUser.password });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toContain("Too many requests");
    expect(blockedRes.headers["retry-after"]).toBeDefined();
  });
});
