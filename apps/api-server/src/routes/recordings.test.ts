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
  let inProgressRecId: number;
  let missingFileRecId: number;
  const rawBaseDir = path.resolve(process.env.RAW_DIR || "data/raw");
  const dummyFilePath = path.join(rawBaseDir, "stream_test_dummy.mp4");
  const inProgressFilePath = path.join(rawBaseDir, "stream_test_in_progress.mp4");
  const dummyFileSize = 2048; // 2 KB

  beforeAll(async () => {
    // Clean leftovers from a previous interrupted run before seeding unique rows.
    await pool.query(
      "DELETE r FROM recordings r JOIN cameras c ON c.id = r.camera_id WHERE c.name = 'Stream Test Cam'"
    );
    await pool.query("DELETE FROM cameras WHERE name = 'Stream Test Cam'");

    // 1. Ensure test directory exists and create dummy file
    await fsp.mkdir(path.dirname(dummyFilePath), { recursive: true });
    const buffer = Buffer.alloc(dummyFileSize, "A");
    await fsp.writeFile(dummyFilePath, buffer);
    await fsp.writeFile(inProgressFilePath, buffer);

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

    // 6. Seed an in-progress recording (must never be served)
    const [inProgressRes] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status)
       VALUES (?, NOW(3), ?, 'RECORDING')`,
      [testCamId, inProgressFilePath]
    );
    inProgressRecId = inProgressRes.insertId;

    // 7. Seed a finished recording whose file no longer exists
    const missingPath = path.join(rawBaseDir, "stream_test_missing.mp4");
    const [missingRes] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status)
       VALUES (?, NOW(3), ?, 'COMPLETED')`,
      [testCamId, missingPath]
    );
    missingFileRecId = missingRes.insertId;
  });

  afterAll(async () => {
    try {
      await fsp.unlink(dummyFilePath);
    } catch {}
    try {
      await fsp.unlink(inProgressFilePath);
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

  it("item 5: an in-progress recording is rejected with 409 Conflict", async () => {
    const res = await request(app)
      .get(`/api/recordings/${inProgressRecId}/stream`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("still in progress");
  });

  it("item 6: list marks only finished recordings with an existing file as playable", async () => {
    const res = await request(app)
      .get(`/api/recordings?camera_id=${testCamId}&limit=100`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const byId = new Map(res.body.recordings.map((r: any) => [r.id, r]));

    expect(byId.get(validRecId)).toMatchObject({
      playable: true,
      has_raw: true,
      has_compressed: false,
    });
    expect(byId.get(inProgressRecId)).toMatchObject({ playable: false, has_raw: true });
    expect(byId.get(missingFileRecId)).toMatchObject({ playable: false, has_raw: false });
    expect(byId.get(traversalRecId)).toMatchObject({ playable: false, has_raw: false });

    for (const rec of res.body.recordings) {
      expect(rec).not.toHaveProperty("raw_path");
      expect(rec).not.toHaveProperty("compressed_path");
    }
  });
});
