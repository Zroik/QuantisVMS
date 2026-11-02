import http from "node:http";
import path from "node:path";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { setupSocketGateway } from "./sockets/gateway.js";
import { migrateUp } from "./db/migrator.js";
import { getDbPool } from "./db/connection.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

export const API_SERVER_VERSION = "1.0.0";

export function getHealthStatus(): { status: string; timestamp: string } {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
}

export async function startServer(port: number = Number(process.env.PORT) || 3000) {
  const pool = getDbPool();
  const migrationsDir = path.resolve(import.meta.dirname, "db/migrations");

  // Wait for MySQL to become ready (up to 30s)
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (err) {
      if (attempt === 15) {
        console.error(`[API Server] MySQL connection failed after 15 attempts:`, err);
      } else {
        console.log(`[API Server] Waiting for MySQL database... (attempt ${attempt}/15)`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  try {
    const applied = await migrateUp(pool, migrationsDir);
    if (applied.length > 0) {
      console.log(`[API Server] Applied migrations: ${applied.join(", ")}`);
    }

    // Seed default admin user if none exists
    const [userRows] = await pool.query<any[]>("SELECT id FROM users LIMIT 1");
    if (userRows.length === 0) {
      const defaultUser = process.env.INITIAL_ADMIN_USER || "admin";
      const defaultPass = process.env.INITIAL_ADMIN_PASSWORD || "admin123";
      const { hashPassword } = await import("./auth/service.js");
      const hashed = await hashPassword(defaultPass);
      await pool.query(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
        [defaultUser, hashed]
      );
      console.log(`[API Server] Seeded initial admin user: ${defaultUser}`);
    }

    // Sync all cameras to Redis & MediaMTX
    try {
      const { deriveCredentialKey, decryptRtspUrl } = await import("./crypto/credentials.js");
      const { getRedisClient } = await import("./redis/client.js");
      const redis = getRedisClient();
      const key = deriveCredentialKey();
      const [cams] = await pool.query<any[]>("SELECT id, rtsp_url_enc FROM cameras WHERE enabled = 1");
      const mediamtxHost = process.env.MEDIAMTX_HOST || "mediamtx";
      const mediamtxApiPort = process.env.MEDIAMTX_API_PORT || 9997;
      const mediamtxSecret = process.env.MEDIAMTX_AUTH_SECRET || "mediamtx_internal_token_secret";
      const authHeader = "Basic " + Buffer.from(`internal_reader:${mediamtxSecret}`).toString("base64");

      for (const c of cams) {
        if (c.rtsp_url_enc) {
          try {
            const plain = decryptRtspUrl(Buffer.from(c.rtsp_url_enc), key);
            await redis.set(`cam:${c.id}:rtsp_url`, plain);
            
            // Sync to MediaMTX
            const mtxRes = await fetch(`http://${mediamtxHost}:${mediamtxApiPort}/v3/config/paths/get/cam${c.id}`, {
              headers: { Authorization: authHeader }
            });
            const mtxPayload = JSON.stringify({
              source: `rtsp://rtsp-proxy:8555/cam${c.id}`,
              sourceOnDemand: false,
              rtspTransport: "tcp"
            });
            if (mtxRes.ok) {
              await fetch(`http://${mediamtxHost}:${mediamtxApiPort}/v3/config/paths/patch/cam${c.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: authHeader },
                body: mtxPayload
              });
            } else {
              await fetch(`http://${mediamtxHost}:${mediamtxApiPort}/v3/config/paths/add/cam${c.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: authHeader },
                body: mtxPayload
              });
            }
            console.log(`[API Server] Synced camera ${c.id} to Redis & MediaMTX`);
          } catch (e: any) {
            console.warn(`[API Server] Error syncing camera ${c.id}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.warn("[API Server] Warning syncing cameras to Redis / MediaMTX:", e);
    }
  } catch (err) {
    console.warn(`[API Server] Migration / seed notice:`, err);
  }

  const app = createApp();
  const server = http.createServer(app);
  const io = setupSocketGateway(server);
  app.set("io", io);

  return new Promise<{ server: http.Server; io: any; port: number }>((resolve) => {
    server.listen(port, () => {
      console.log(`[API Server] Listening on port ${port} (v${API_SERVER_VERSION})`);
      resolve({ server, io, port });
    });
  });
}

// Auto-start if executed directly
if (
  process.argv[1] &&
  (process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("index.js"))
) {
  startServer().catch(console.error);
}
