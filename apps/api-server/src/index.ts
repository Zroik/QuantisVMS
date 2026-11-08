import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { setupSocketGateway } from "./sockets/gateway.js";
import { migrateUp } from "./db/migrator.js";
import { getDbPool, closeDbPool } from "./db/connection.js";
import { closeRedisClients } from "./redis/client.js";
import { assertSecureConfig } from "./config/validate.js";

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
  assertSecureConfig(process.env, {
    jwt: true,
    credential: true,
    mediaMtx: true,
    mysql: true,
    redis: true,
  });
  const pool = getDbPool();
  const migrationsDir = path.resolve(import.meta.dirname, "db/migrations");

  // Wait for MySQL to become ready (up to 30s)
  let dbConnected = false;
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      await pool.query("SELECT 1");
      dbConnected = true;
      break;
    } catch (err) {
      if (attempt === 15) {
        console.error(`[API Server] MySQL connection failed after 15 attempts:`, err);
        if (process.env.NODE_ENV === "production") {
          process.exit(1);
        }
      } else {
        console.log(`[API Server] Waiting for MySQL database... (attempt ${attempt}/15)`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  if (dbConnected) {
    try {
      const applied = await migrateUp(pool, migrationsDir);
      if (applied.length > 0) {
        console.log(`[API Server] Applied migrations: ${applied.join(", ")}`);
      }

      // Seed default admin user if none exists
      const [userRows] = await pool.query<any[]>("SELECT id FROM users LIMIT 1");
      if (userRows.length === 0) {
        const defaultUser = process.env.INITIAL_ADMIN_USER || process.env.ADMIN_DEFAULT_USER || "admin";
        let defaultPass = process.env.INITIAL_ADMIN_PASSWORD || process.env.ADMIN_DEFAULT_PASSWORD;
        if (!defaultPass) {
          const cryptoMod = await import("node:crypto");
          defaultPass = cryptoMod.randomBytes(12).toString("base64url");
          if (process.env.NODE_ENV === "production") {
            // Never write a credential to the container log; persist it 0600.
            const secretFile = path.join(process.env.DATA_DIR || "/data", ".initial_admin_password");
            try {
              await fs.mkdir(path.dirname(secretFile), { recursive: true });
              await fs.writeFile(secretFile, `${defaultPass}\n`, { mode: 0o600 });
              console.warn(
                `[API Server] Generated initial admin password for '${defaultUser}' and wrote it to ${secretFile} (mode 0600). Delete it after the first login.`
              );
            } catch (err: any) {
              if (process.env.NODE_ENV === "production") {
                throw new Error(`Cannot persist initial admin password: ${err.message}`);
              }
              console.warn(`[API Server] Could not persist initial admin password: ${err.message}`);
            }
          } else {
            console.warn(
              `[API Server] SECURITY NOTICE: INITIAL_ADMIN_PASSWORD not set; generated random initial admin password for '${defaultUser}': ${defaultPass}`
            );
          }
        }
        const { hashPassword } = await import("./auth/service.js");
        const hashed = await hashPassword(defaultPass);
        await pool.query(
          "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
          [defaultUser, hashed]
        );
        console.log(`[API Server] Seeded initial admin user: ${defaultUser}`);
      }

      // Sync all cameras to Redis & MediaMTX (encrypted RTSP envelope only)
      try {
        const { deriveCredentialKey, decryptRtspUrl, encodeEncryptedRtspForRedis } = await import(
          "./crypto/credentials.js"
        );
        const { getRedisClient } = await import("./redis/client.js");
        const { syncCameraToMediaMTX } = await import("./mediamtx/client.js");
        const redis = getRedisClient();
        const key = deriveCredentialKey();
        const [cams] = await pool.query<any[]>("SELECT id, rtsp_url_enc FROM cameras WHERE enabled = 1");

        for (const c of cams) {
          if (c.rtsp_url_enc) {
            try {
              const encBuf = Buffer.from(c.rtsp_url_enc);
              // Validate ciphertext integrity before caching encrypted envelope in Redis
              decryptRtspUrl(encBuf, key);
              await redis.set(`cam:${c.id}:rtsp_url`, encodeEncryptedRtspForRedis(encBuf));
              const synced = await syncCameraToMediaMTX(c.id);
              if (synced) {
                console.log(`[API Server] Synced camera ${c.id} to Redis & MediaMTX`);
              } else {
                console.warn(`[API Server] Camera ${c.id} saved to Redis, but MediaMTX sync failed`);
              }
            } catch (e: any) {
              console.warn(`[API Server] Error syncing camera ${c.id}:`, e.message);
            }
          }
        }
      } catch (e) {
        console.warn("[API Server] Warning syncing cameras to Redis / MediaMTX:", e);
      }
    } catch (err) {
      console.error(`[API Server] Migration / seed error:`, err);
      if (process.env.NODE_ENV === "production") {
        process.exit(1);
      }
    }
  }

  const app = createApp();
  const server = http.createServer(app);
  const io = setupSocketGateway(server);
  app.set("io", io);

  // Graceful shutdown: stop accepting connections, then drain sockets/Redis/DB.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[API Server] ${signal} received; shutting down gracefully...`);
    // Close Socket.IO (and its WebSocket connections) BEFORE awaiting
    // server.close(), otherwise the HTTP close callback never fires.
    try {
      io.close();
    } catch {}
    try {
      (server as any).closeAllConnections?.();
    } catch {}
    const forceTimer = setTimeout(() => {
      try {
        (server as any).closeAllConnections?.();
      } catch {}
      process.exit(1);
    }, 5000);
    forceTimer.unref?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearTimeout(forceTimer);
    await closeRedisClients().catch(() => {});
    await closeDbPool().catch(() => {});
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

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
