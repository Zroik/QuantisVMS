import { Redis } from "ioredis";
import mysql from "mysql2/promise";

async function main(): Promise<void> {
  const redis = new Redis({
    host: process.env.REDIS_HOST || "redis",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || "mysql",
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || "vms_user",
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || "vms_db",
    connectionLimit: 1,
    connectTimeout: 3000,
  });

  try {
    await redis.connect();
    await redis.ping();
    await pool.query("SELECT 1");
    const heartbeat = await redis.get("recorder:heartbeat");
    if (!heartbeat || Date.now() - Number(heartbeat) > 30000) {
      throw new Error("recorder heartbeat is stale or missing");
    }
    console.log("recorder healthy");
    process.exitCode = 0;
  } finally {
    redis.disconnect();
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("recorder unhealthy:", err.message);
  process.exit(1);
});
