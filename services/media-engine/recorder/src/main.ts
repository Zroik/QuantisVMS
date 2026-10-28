import mysql from "mysql2/promise";
import { Redis } from "ioredis";
import path from "node:path";
import dotenv from "dotenv";
import { RecorderService } from "./recorder.js";
import { deriveCredentialKey, decryptRtspUrl } from "./crypto.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../../.env") });

async function startRecorder() {
  console.log("[Recorder] Starting Recorder Service (Spec §8.1)...");

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || "mysql",
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || "vms_user",
    password: process.env.MYSQL_PASSWORD || "vms_password_secret",
    database: process.env.MYSQL_DATABASE || "vms_db",
    waitForConnections: true,
    connectionLimit: 10,
  });

  const redis = new Redis({
    host: process.env.REDIS_HOST || "redis",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || "redis_password_secret",
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  const subRedis = new Redis({
    host: process.env.REDIS_HOST || "redis",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || "redis_password_secret",
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  const rawDir = process.env.RAW_DIR || "data/raw";
  const segmentSec = Number(process.env.SEGMENT_SEC) || 60;

  const recorder = new RecorderService({
    pool,
    redis,
    rawDir,
    segmentSec,
  });

  // Start reconciler
  await recorder.start();
  console.log("[Recorder] Startup reconciliation complete.");

  const credKey = deriveCredentialKey();

  // Load existing enabled cameras from DB
  const [cameras] = await pool.query<any[]>(
    "SELECT id, rtsp_url_enc, enabled FROM cameras WHERE enabled = 1"
  );

  for (const cam of cameras) {
    try {
      const rtspUrl = decryptRtspUrl(cam.rtsp_url_enc, credKey);
      await recorder.registerCamera(cam.id, rtspUrl);
      console.log(`[Recorder] Registered camera ${cam.id}`);
    } catch (err: any) {
      console.error(`[Recorder] Failed to register camera ${cam.id}:`, err.message);
    }
  }

  // Subscribe to camera:changed
  await subRedis.subscribe("camera:changed");
  subRedis.on("message", async (channel, message) => {
    if (channel !== "camera:changed") return;
    try {
      const payload = JSON.parse(message);
      const camId = Number(payload.camera_id);
      const action = payload.action;

      if (action === "added" || action === "updated") {
        let rtspUrl = payload.rtsp_url;
        if (!rtspUrl) {
          const [rows] = await pool.query<any[]>(
            "SELECT rtsp_url_enc FROM cameras WHERE id = ? AND enabled = 1",
            [camId]
          );
          if (rows.length > 0) {
            rtspUrl = decryptRtspUrl(rows[0].rtsp_url_enc, credKey);
          }
        }
        if (rtspUrl) {
          await recorder.unregisterCamera(camId);
          await recorder.registerCamera(camId, rtspUrl);
          console.log(`[Recorder] Dynamic update: camera ${camId} registered`);
        }
      } else if (action === "removed") {
        await recorder.unregisterCamera(camId);
        console.log(`[Recorder] Dynamic update: camera ${camId} stopped`);
      }
    } catch (err: any) {
      console.error("[Recorder] Error handling camera:changed event:", err.message);
    }
  });

  const shutdown = async (signal: string) => {
    console.log(`[Recorder] Received ${signal}. Shutting down...`);
    await recorder.stop();
    await subRedis.quit();
    await redis.quit();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[Recorder] Service is active and monitoring streams.");
}

startRecorder().catch((err) => {
  console.error("[Recorder] Fatal error during startup:", err);
  process.exit(1);
});

