import { createPool } from "../apps/api-server/node_modules/mysql2/promise.js";
import { Redis } from "../apps/api-server/node_modules/ioredis/built/index.js";

async function main() {
  const pool = createPool({
    host: "127.0.0.1",
    port: 3306,
    user: "vms_user",
    password: "vms_password_secret",
    database: "vms_db",
  });

  const redis = new Redis({
    host: "127.0.0.1",
    port: 6379,
    password: "redis_password_secret",
  });

  console.log("Resetting pending transcode recordings in MySQL to RAW...");
  const [res] = await pool.query(
    "UPDATE recordings SET status = 'RAW' WHERE status IN ('QUEUED', 'PROBING', 'ENCODING', 'VERIFYING')"
  );
  console.log("Updated recordings:", res.affectedRows);

  console.log("Flushing stale transcode BullMQ queue keys from Redis...");
  const keys = await redis.keys("bull:transcode:*");
  if (keys.length > 0) {
    const pipeline = redis.pipeline();
    for (const k of keys) {
      pipeline.del(k);
    }
    await pipeline.exec();
    console.log(`Deleted ${keys.length} stale transcode keys from Redis.`);
  } else {
    console.log("No stale keys in Redis.");
  }

  await pool.end();
  await redis.quit();
  console.log("Cleanup complete!");
}

main().catch(console.error);

