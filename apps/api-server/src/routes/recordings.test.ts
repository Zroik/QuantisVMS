import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import path from "node:path";
import fsp from "node:fs/promises";
import { createApp } from "../app.js";
import { getDbPool, closeDbPool } from "../db/connection.js";
import { hashPassword, generateTokens } from "../auth/service.js";

describe("Gate G3.8: Recordings Stream Endpoint (Range 206, 401 Unauth, Traversal Rejected)", () => {
  const app = createApp();
  const pool = getDbPool();

  let adminToken: string;
  let testCamId: number;
  let validRecId: number;
  let traversalRecId: number;
  const rawBaseDir = path.resolve(process.env.RAW_DIR || "data/raw");
  const dummyFilePath = path.join(rawBaseDir, "stream_test_dummy.mp4");
  const dummyFileSize = 2048; // 2 KB

  beforeAll(async () => {
    // 1. Ensure test directory exists and create dummy file
    await fsp.mkdir(path.dirname(dummyFilePath), { recursive: true });
    const buffer = Buffer.alloc(dummyFileSize, "A");
    await fsp.writeFile(dummyFilePath, buffer);

    // 2. Seed admin user
    await pool.query("DELETE FROM users WHERE username = 'rec_test_admin'");
    const hashed = await hashPassword("AdminPass123!");
    const [userRes] = await pool.query<any>(
      "INSERT INTO users (username, password_hash, role) VALUES ('rec_test_admin', ?, 'admin')",
      [hashed]
    );
    const tokens = await generateTokens({
      userId: userRes.insertId,
      username: "rec_test_admin",
      role: "admin",
    });
    adminToken = tokens.accessToken;

    // 3. Seed test camera
    const [camRes] = await pool.query<any>(
      `INSERT INTO cameras (name, rtsp_url_enc, rtsp_host, enabled, active_yolo_classes)
       VALUES ('Stream Test Cam', 0x1234, '127.0.0.1:554', 1, '[]')`
    );
    testCamId = camRes.insertId;

    // 4. Seed valid recording pointing to dummy file
    const [validRecRes] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status)
       VALUES (?, NOW(3), ?, 'RAW')`,
      [testCamId, dummyFilePath]
    );
    validRecId = validRecRes.insertId;

    // 5. Seed malicious recording pointing outside allowed directory
    const traversalPath = path.resolve("temp_traversal_test.txt");
    const [travRecRes] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status)
       VALUES (?, NOW(3), ?, 'RAW')`,
      [testCamId, traversalPath]
    );
    traversalRecId = travRecRes.insertId;
  });

  afterAll(async () => {
    try {
      await fsp.unlink(dummyFilePath);
    } catch {}
    await pool.query("DELETE FROM recordings WHERE camera_id = ?", [testCamId]);
    await pool.query("DELETE FROM cameras WHERE id = ?", [testCamId]);
    await pool.query("DELETE FROM users WHERE username = 'rec_test_admin'");
    await closeDbPool();
  });

  it("item 1: unauthenticated request to stream endpoint is rejected with 401 Unauthorized", async () => {
    const res = await request(app).get(`/api/recordings/${validRecId}/stream`);
    expect(res.status).toBe(401);
  });

  it("item 2: path traversal attempts are rejected with 403 Forbidden", async () => {
    const res = await request(app)
      .get(`/api/recordings/${traversalRecId}/stream`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Access denied: file outside permitted storage path");
  });

  it("item 3: HTTP Range request returns 206 Partial Content with proper byte slicing", async () => {
    const rangeHeader = "bytes=100-599"; // 500 bytes requested
    const res = await request(app)
      .get(`/api/recordings/${validRecId}/stream`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Range", rangeHeader);

    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 100-599/${dummyFileSize}`);
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-length"]).toBe("500");
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.body.length).toBe(500);
  });

  it("item 4: full stream request without Range header returns 200 OK with full file", async () => {
    const res = await request(app)
      .get(`/api/recordings/${validRecId}/stream`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-length"]).toBe(String(dummyFileSize));
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.body.length).toBe(dummyFileSize);
  });
});
