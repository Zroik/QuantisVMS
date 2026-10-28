import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { getDbPool, closeDbPool } from "../db/connection.js";
import { getRedisClient, getRedisSubClient, closeRedisClients } from "../redis/client.js";
import { hashPassword, generateTokens } from "../auth/service.js";
import { deriveCredentialKey, decryptRtspUrl } from "../crypto/credentials.js";

describe("Gates G3.3 & G3.4: Cameras API, Encryption, and Toggle Recomputation", () => {
  const app = createApp();
  const pool = getDbPool();
  const redis = getRedisClient();

  let adminToken: string;
  let testCamId: number;
  const rawRtspUrl = "rtsp://admin:REDACTED-LEAKED-PASSWORD@192.168.100.67:554/Streaming/Channels/101";

  beforeAll(async () => {
    // Seed admin user
    await pool.query("DELETE FROM users WHERE username = 'cam_test_admin'");
    const hashed = await hashPassword("AdminPass123!");
    const [userRes] = await pool.query<any>(
      "INSERT INTO users (username, password_hash, role) VALUES ('cam_test_admin', ?, 'admin')",
      [hashed]
    );
    const tokens = await generateTokens({
      userId: userRes.insertId,
      username: "cam_test_admin",
      role: "admin",
    });
    adminToken = tokens.accessToken;
  });

  afterAll(async () => {
    if (testCamId) {
      await pool.query("DELETE FROM cameras WHERE id = ?", [testCamId]);
      await redis.del(`cam:${testCamId}:classes`, `cam:${testCamId}:conf`, `cam:${testCamId}:rev`);
    }
    await pool.query("DELETE FROM users WHERE username = 'cam_test_admin'");
    await closeDbPool();
    await closeRedisClients();
  });

  it("G3.3: creates camera, stores encrypted ciphertext in DB, returns masked RTSP URL without credentials", async () => {
    const res = await request(app)
      .post("/api/cameras")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Hikvision CCTV Test",
        rtsp_url: rawRtspUrl,
        confidence_threshold: 0.35,
        target_vmaf: 85.0,
        target_vmaf_p25: 81.0,
      });

    expect(res.status).toBe(201);
    testCamId = res.body.id;
    expect(testCamId).toBeGreaterThan(0);

    // Verify response never contains unmasked credentials
    expect(res.text).not.toContain("REDACTED-LEAKED-PASSWORD");
    expect(res.body.rtsp_url).toBe("rtsp://***:***@192.168.100.67:554/Streaming/Channels/101");
    expect(res.body.rtsp_host).toBe("192.168.100.67:554");

    // Inspect DB table directly: DB column rtsp_url_enc must hold ciphertext, not plaintext
    const [dbRows] = await pool.query<any[]>(
      "SELECT rtsp_url_enc FROM cameras WHERE id = ?",
      [testCamId]
    );
    expect(dbRows.length).toBe(1);
    const encBuf = Buffer.from(dbRows[0].rtsp_url_enc);
    expect(encBuf.toString("utf-8")).not.toContain("REDACTED-LEAKED-PASSWORD");
    expect(encBuf.toString("utf-8")).not.toContain("rtsp://");

    // Decrypting with server key reconstructs original URL
    const key = deriveCredentialKey();
    const decrypted = decryptRtspUrl(encBuf, key);
    expect(decrypted).toBe(rawRtspUrl);
  });

  it("G3.4: PUT /api/cameras/:id/classes rejects invalid class IDs with 400 Bad Request", async () => {
    // Out-of-range class ID 80
    const res1 = await request(app)
      .put(`/api/cameras/${testCamId}/classes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ custom_class_ids: [0, 80] });

    expect(res1.status).toBe(400);
    expect(res1.body.error).toContain("must be an integer between 0 and 79");

    // Negative class ID
    const res2 = await request(app)
      .put(`/api/cameras/${testCamId}/classes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ custom_class_ids: [-1] });

    expect(res2.status).toBe(400);
    expect(res2.body.error).toContain("must be an integer between 0 and 79");
  });

  it("G3.4: PUT /api/cameras/:id/classes recomputes active IDs, updates Redis keys, and publishes to ai:toggle", async () => {
    const subRedis = getRedisSubClient();
    let publishedMessage: any = null;

    await subRedis.subscribe("ai:toggle");
    const onMessage = (channel: string, message: string) => {
      if (channel === "ai:toggle") {
        publishedMessage = JSON.parse(message);
      }
    };
    subRedis.on("message", onMessage);

    // Toggle: preset group 'vehicles' [1,2,3,5,7] and 'person' [0], plus custom classes [14, 15] (bird, cat)
    const res = await request(app)
      .put(`/api/cameras/${testCamId}/classes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        preset_groups: { person: true, vehicles: true },
        custom_class_ids: [14, 15],
        confidence_threshold: 0.42,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.resolved_active_ids).toEqual([0, 1, 2, 3, 5, 7, 14, 15]);
    expect(res.body.confidence_threshold).toBe(0.42);
    expect(res.body.rev).toBeGreaterThan(0);

    // Verify Redis keys
    const redisClasses = await redis.get(`cam:${testCamId}:classes`);
    expect(redisClasses).toBe(JSON.stringify([0, 1, 2, 3, 5, 7, 14, 15]));

    const redisConf = await redis.get(`cam:${testCamId}:conf`);
    expect(redisConf).toBe("0.42");

    // Wait briefly for pubsub delivery
    await new Promise((r) => setTimeout(r, 100));
    expect(publishedMessage).toBeDefined();
    expect(publishedMessage.camera_id).toBe(testCamId);
    expect(publishedMessage.resolved_active_ids).toEqual([0, 1, 2, 3, 5, 7, 14, 15]);
    expect(publishedMessage.confidence_threshold).toBe(0.42);
    expect(publishedMessage.rev).toBe(res.body.rev);

    subRedis.off("message", onMessage);
    await subRedis.unsubscribe("ai:toggle");
  });

  it("GET /api/yolo/classes returns 80 COCO classes with id, name, and group", async () => {
    const res = await request(app)
      .get("/api/yolo/classes")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(80);
    expect(res.body.classes.length).toBe(80);
    const person = res.body.classes.find((c: any) => c.id === 0);
    expect(person).toEqual({ id: 0, name: "person", group: "person" });
  });
});
