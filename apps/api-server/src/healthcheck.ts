import { Redis } from "ioredis";
import { getDbPool } from "./db/connection.js";

async function main(): Promise<void> {
  const key = process.env.HEALTH_KEY || "transcode:heartbeat";
  const maxAgeMs = Number(process.env.HEALTH_MAX_AGE_MS) || 90000;
  const redis = new Redis({
    host: process.env.REDIS_HOST || "redis",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await redis.connect();
  await redis.ping();
  const value = await redis.get(key);
  redis.disconnect();
  if (!value || Date.now() - Number(value) > maxAgeMs) {
    throw new Error(`${key} is stale or missing`);
  }
  const pool = getDbPool();
  await pool.query("SELECT 1");
  console.log("healthy");
  process.exit(0);
}

main().catch((err) => {
  console.error("unhealthy:", err.message);
  process.exit(1);
});
