#!/usr/bin/env node
/**
 * Seeds the two physical Quantis cameras (Hikvision + V380 Pro).
 *
 * Writes the same state the POST /api/cameras route writes, so a directly
 * seeded camera behaves exactly like one created through the dashboard:
 *   - cameras row with AES-256-GCM encrypted RTSP URL and ONVIF password
 *   - Redis routing keys (rtsp_url, classes, conf, rev)
 *   - MediaMTX path cam<id> pointing at the RTSP proxy
 *   - camera:changed notification for the recorder and AI worker
 *
 * Idempotent: a camera with the same ONVIF xaddr or name is updated in place.
 *
 * Usage (from the repository root, with the Docker stack running):
 *   node scripts/seed-cameras.mjs
 */
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const serverRequire = createRequire(path.join(repoRoot, "apps", "api-server", "package.json"));

const mysql = serverRequire("mysql2/promise");
const RedisModule = serverRequire("ioredis");
const Redis = RedisModule.default || RedisModule;
const dotenv = serverRequire("dotenv");

dotenv.config({ path: path.join(repoRoot, ".env") });

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const DEFAULT_ACTIVE_CLASS_IDS = [0, 1, 2, 3, 5, 7, 14, 15, 16];

const CAMERAS = [
  {
    name: "hikvision",
    rtsp_url: "rtsp://admin:REDACTED-LEAKED-PASSWORD%40@192.168.100.67:554/Streaming/Channels/101",
    rtsp_host: "192.168.100.67:554",
    onvif_xaddr: "http://192.168.100.67/onvif/device_service",
    onvif_user: "admin",
    onvif_pass: "REDACTED-LEAKED-PASSWORD@",
    capabilities: { ptz: false, imaging: true, events: true },
  },
  {
    name: "v380 pro",
    rtsp_url: "rtsp://192.168.100.16",
    rtsp_host: "192.168.100.16",
    onvif_xaddr: "http://192.168.100.16:8899/onvif/device_service",
    onvif_user: null,
    onvif_pass: null,
    capabilities: { ptz: true, imaging: false, events: false },
  },
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[Seed] ${name} is required (checked repository .env).`);
    process.exit(1);
  }
  return value;
}

const credentialKey = Buffer.from(requireEnv("CREDENTIAL_KEY"), "base64");
if (credentialKey.length !== 32) {
  console.error(`[Seed] CREDENTIAL_KEY must decode to exactly 32 bytes (got ${credentialKey.length}).`);
  process.exit(1);
}

/**
 * AES-256-GCM with the project wire format: [12-byte IV][16-byte tag][ciphertext].
 */
function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", credentialKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function maskRtspUrl(url) {
  return url.replace(/:\/\/[^:/]+:[^@]+@/, "://***:***@");
}

function mediaMtxBaseUrl() {
  if (process.env.MEDIAMTX_API_URL) return process.env.MEDIAMTX_API_URL.replace(/\/$/, "");
  const port = process.env.MEDIAMTX_API_PORT || "9997";
  return `http://127.0.0.1:${port}`;
}

function mediaMtxAuthHeader() {
  const secret = process.env.MEDIAMTX_AUTH_SECRET;
  if (!secret) return null;
  return "Basic " + Buffer.from(`internal_reader:${secret}`).toString("base64");
}

async function syncMediaMtxPath(cameraId) {
  const auth = mediaMtxAuthHeader();
  if (!auth) {
    console.warn("[Seed] MEDIAMTX_AUTH_SECRET is missing; MediaMTX path was not created.");
    return false;
  }

  const baseUrl = mediaMtxBaseUrl();
  const body = JSON.stringify({
    source: `rtsp://rtsp-proxy:8555/cam${cameraId}`,
    sourceOnDemand: false,
    rtspTransport: "tcp",
  });

  try {
    const check = await fetch(`${baseUrl}/v3/config/paths/get/cam${cameraId}`, { headers: { Authorization: auth } });
    if (check.ok) {
      const patched = await fetch(`${baseUrl}/v3/config/paths/patch/cam${cameraId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body,
      });
      return patched.ok;
    }
    const added = await fetch(`${baseUrl}/v3/config/paths/add/cam${cameraId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body,
    });
    return added.ok;
  } catch (err) {
    console.warn(`[Seed] Could not sync MediaMTX path cam${cameraId}: ${err.message}`);
    return false;
  }
}

async function findExistingCamera(pool, camera) {
  const [rows] = await pool.query(
    "SELECT id, name FROM cameras WHERE onvif_xaddr = ? OR name = ? LIMIT 1",
    [camera.onvif_xaddr, camera.name]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function upsertCamera(pool, camera) {
  const rtspEnc = encryptSecret(camera.rtsp_url);
  const passEnc = camera.onvif_pass ? encryptSecret(camera.onvif_pass) : null;
  const activePayload = {
    preset_groups: {},
    custom_class_ids: [],
    resolved_active_ids: DEFAULT_ACTIVE_CLASS_IDS,
  };
  const capabilitiesJson = JSON.stringify(camera.capabilities);
  const existing = await findExistingCamera(pool, camera);

  if (existing) {
    await pool.query(
      `UPDATE cameras SET
         name = ?, rtsp_url_enc = ?, rtsp_host = ?, onvif_xaddr = ?, onvif_user = ?,
         onvif_pass_enc = ?, onvif_capabilities = ?, enabled = 1, active_yolo_classes = ?,
         confidence_threshold = 0.35, target_vmaf = 85.0, target_vmaf_p25 = 81.0,
         preferred_encoder = 'av1_nvenc', smart_ai_sampling = 1, split_count = 1, slice_index = 0
       WHERE id = ?`,
      [
        camera.name,
        rtspEnc,
        camera.rtsp_host,
        camera.onvif_xaddr,
        camera.onvif_user,
        passEnc,
        capabilitiesJson,
        JSON.stringify(activePayload),
        existing.id,
      ]
    );
    return { id: existing.id, created: false };
  }

  const [result] = await pool.query(
    `INSERT INTO cameras (
      name, rtsp_url_enc, rtsp_host, onvif_xaddr, onvif_user, onvif_pass_enc, onvif_capabilities,
      enabled, active_yolo_classes, confidence_threshold, target_vmaf, target_vmaf_p25,
      preferred_encoder, smart_ai_sampling, split_count, slice_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0.35, 85.0, 81.0, 'av1_nvenc', 1, 1, 0)`,
    [
      camera.name,
      rtspEnc,
      camera.rtsp_host,
      camera.onvif_xaddr,
      camera.onvif_user,
      passEnc,
      capabilitiesJson,
      JSON.stringify(activePayload),
    ]
  );

  return { id: result.insertId, created: true };
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    // This script runs on the Windows host, so it must use the published host
    // ports (3307/6380), not the in-container ports from .env (3306/6379).
    port: Number(process.env.MYSQL_HOST_PORT) || 3307,
    user: process.env.MYSQL_USER || "vms_user",
    password: requireEnv("MYSQL_PASSWORD"),
    database: process.env.MYSQL_DATABASE || "vms_db",
    connectionLimit: 2,
  });

  const redis = new Redis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_HOST_PORT) || 6380,
    password: requireEnv("REDIS_PASSWORD"),
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => (times > 3 ? null : 250),
  });

  try {
    await redis.connect();
  } catch (err) {
    console.error(`[Seed] Redis connection failed: ${err.message}`);
    await pool.end().catch(() => {});
    process.exit(1);
  }

  const seeded = [];

  try {
    for (const camera of CAMERAS) {
      const { id, created } = await upsertCamera(pool, camera);

      await redis.set(`cam:${id}:rtsp_url`, camera.rtsp_url);
      await redis.set(`cam:${id}:classes`, JSON.stringify(DEFAULT_ACTIVE_CLASS_IDS));
      await redis.set(`cam:${id}:conf`, "0.35");
      await redis.set(`cam:${id}:rev`, "1");
      await redis.publish(
        "camera:changed",
        JSON.stringify({ camera_id: id, action: created ? "added" : "updated", enabled: true, rtsp_url: camera.rtsp_url })
      );

      const mediamtxSynced = await syncMediaMtxPath(id);

      seeded.push({ id, name: camera.name, created, mediamtxSynced });
      console.log(
        `[Seed] Camera #${id} (${camera.name}) ${created ? "created" : "updated"} · ` +
          `${maskRtspUrl(camera.rtsp_url)} · MediaMTX path ${mediamtxSynced ? "ready" : "NOT synced"}`
      );
    }
  } finally {
    await pool.end().catch(() => {});
    await redis.quit().catch(() => {});
  }

  const failed = seeded.filter((entry) => !entry.mediamtxSynced);
  if (failed.length > 0) {
    console.warn(
      `[Seed] ${failed.length} camera(s) seeded without a MediaMTX path: ` +
        failed.map((entry) => `#${entry.id} ${entry.name}`).join(", ")
    );
  }

  console.log(`[Seed] Done. ${seeded.length} camera(s) provisioned.`);
}

main().catch((err) => {
  console.error("[Seed] Failed:", err.message);
  process.exit(1);
});
