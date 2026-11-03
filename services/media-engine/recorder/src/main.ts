import mysql from "mysql2/promise";
import { Redis } from "ioredis";
import path from "node:path";
import dotenv from "dotenv";
import { RecorderService } from "./recorder.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

process.on("unhandledRejection", (reason) => {
  console.error("[Recorder] Unhandled promise rejection (kept alive):", reason);
});

function assertProdSecrets(): void {
  if (process.env.NODE_ENV !== "production") return;
  const weak = ["vms_password_secret", "redis_password_secret", "mediamtx_internal_token_secret"];
  for (const key of ["MYSQL_PASSWORD", "REDIS_PASSWORD", "MEDIAMTX_AUTH_SECRET", "CREDENTIAL_KEY"]) {
    const value = process.env[key];
    if (!value || weak.includes(value)) {
      throw new Error(`Refusing to start recorder with insecure ${key}`);
    }
  }
}

async function startRecorder() {
  assertProdSecrets();
  console.log("[Recorder] Starting Recorder Service...");

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || "mysql",
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || "vms_user",
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || "vms_db",
    waitForConnections: true,
    connectionLimit: 10,
  });

  const redis = new Redis({
    host: process.env.REDIS_HOST || "redis",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });
  redis.on("error", (err) => console.error("[Recorder] Redis error:", err.message));

  const subRedis = new Redis({
    host: process.env.REDIS_HOST || "redis",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  subRedis.on("error", (err) => console.error("[Recorder] Redis subscriber error:", err.message));

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

  // Load existing enabled parent cameras from DB (children are UI-only slices)
  const [cameras] = await pool.query<any[]>(
    "SELECT id FROM cameras WHERE enabled = 1 AND parent_camera_id IS NULL"
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
          const [rows] = await pool.query<any[]>(
            "SELECT enabled, parent_camera_id FROM cameras WHERE id = ?",
            [camId]
          );
          const row = rows[0];
          if (!row || !row.enabled || row.parent_camera_id) {
            await recorder.unregisterCamera(camId);
            return;
          }
          if (action === "updated" && !payload.rtsp_url && recorder.getSupervisor(camId)) {
            // Metadata-only update: do not restart the stream.
            return;
          }
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

  let heartbeat: NodeJS.Timeout | null = null;
  const shutdown = async (signal: string) => {
    console.log(`[Recorder] Received ${signal}. Shutting down...`);
    if (heartbeat) clearInterval(heartbeat);
    await recorder.stop();
    await subRedis.quit();
    await redis.quit();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  heartbeat = setInterval(() => {
    void redis
      .set("recorder:heartbeat", String(Date.now()), "EX", 30)
      .catch((err) => console.error("[Recorder] Heartbeat failed:", err.message));
  }, 10000);
  heartbeat.unref?.();
  void redis.set("recorder:heartbeat", String(Date.now()), "EX", 30).catch(() => {});

  console.log("[Recorder] Service is active and monitoring streams.");
}

startRecorder().catch((err) => {
  console.error("[Recorder] Fatal error during startup:", err);
  process.exit(1);
});

