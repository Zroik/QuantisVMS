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
  let segmentSec = Number(process.env.SEGMENT_SEC) || 3600;
  try {
    const [cfgRows] = await pool.query<any[]>(
      "SELECT config_value FROM system_config WHERE config_key = 'recording' LIMIT 1"
    );
    if (cfgRows.length > 0) {
      const val = typeof cfgRows[0].config_value === "string"
        ? JSON.parse(cfgRows[0].config_value)
        : cfgRows[0].config_value;
      if (val?.segmentDurationMin) {
        segmentSec = Math.max(60, Number(val.segmentDurationMin) * 60);
      }
    }
  } catch {
    // fallback to env default
  }

  const recorder = new RecorderService({
    pool,
    redis,
    rawDir,
    segmentSec,
  });

  // Start reconciler
  await recorder.start();
  console.log("[Recorder] Startup reconciliation complete.");

  // Spec §10 item E10: Internal stream pull from MediaMTX (single connection multiplexing)
  const mediamtxSecret = process.env.MEDIAMTX_AUTH_SECRET || "mediamtx_internal_token_secret";
  const mediamtxHost = process.env.MEDIAMTX_HOST || "mediamtx";
  const mediamtxPort = process.env.MEDIAMTX_RTSP_PORT || 8554;

  const getInternalStreamUrl = (camId: number) => {
    return `rtsp://internal_reader:${mediamtxSecret}@${mediamtxHost}:${mediamtxPort}/cam${camId}`;
  };

  // Load existing enabled cameras from DB
  const [cameras] = await pool.query<any[]>(
    "SELECT id, enabled FROM cameras WHERE enabled = 1"
  );

  for (const cam of cameras) {
    try {
      const rtspUrl = getInternalStreamUrl(cam.id);
      await recorder.registerCamera(cam.id, rtspUrl);
      console.log(`[Recorder] Registered camera ${cam.id} via MediaMTX internal stream`);
    } catch (err: any) {
      console.error(`[Recorder] Failed to register camera ${cam.id}:`, err.message);
    }
  }

  // Subscribe to camera:changed and system:config_changed
  await subRedis.subscribe("camera:changed", "system:config_changed");
  subRedis.on("message", async (channel, message) => {
    if (channel === "camera:changed") {
      try {
        const payload = JSON.parse(message);
        const camId = Number(payload.camera_id);
        const action = payload.action;

        if (action === "added" || action === "updated") {
          const rtspUrl = getInternalStreamUrl(camId);
          await recorder.unregisterCamera(camId);
          await recorder.registerCamera(camId, rtspUrl);
          console.log(`[Recorder] Dynamic update: camera ${camId} registered via MediaMTX`);
        } else if (action === "removed") {
          await recorder.unregisterCamera(camId);
          console.log(`[Recorder] Dynamic update: camera ${camId} stopped`);
        }
      } catch (err: any) {
        console.error("[Recorder] Error handling camera:changed event:", err.message);
      }
    } else if (channel === "system:config_changed") {
      try {
        const payload = JSON.parse(message);
        if (payload?.recording?.segmentDurationMin) {
          const newSec = Math.max(60, Number(payload.recording.segmentDurationMin) * 60);
          recorder.setSegmentSec(newSec);
          console.log(`[Recorder] Dynamic update: segment duration configured to ${newSec}s (${payload.recording.segmentDurationMin} min)`);
        }
      } catch (err: any) {
        console.error("[Recorder] Error handling system:config_changed event:", err.message);
      }
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

