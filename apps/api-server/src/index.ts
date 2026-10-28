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
  // Run pending database migrations
  const pool = getDbPool();
  const migrationsDir = path.resolve(import.meta.dirname, "db/migrations");
  try {
    const applied = await migrateUp(pool, migrationsDir);
    if (applied.length > 0) {
      console.log(`[API Server] Applied migrations: ${applied.join(", ")}`);
    }
  } catch (err) {
    console.warn(`[API Server] Migration runner notice:`, err);
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
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  startServer().catch(console.error);
}
