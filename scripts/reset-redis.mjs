import Redis from "ioredis";

async function main() {
  const redis = new Redis({
    host: "127.0.0.1",
    port: 6379,
    password: "redis_password_secret",
  });

  console.log("Connected to Redis...");

  // Delete old keys
  const oldKeys = await redis.keys("cam:7:*");
  const oldKeys8 = await redis.keys("cam:8:*");
  const allOld = [...oldKeys, ...oldKeys8];
  if (allOld.length > 0) {
    await redis.del(...allOld);
    console.log(`Deleted ${allOld.length} old cam keys.`);
  }

  // Camera 1: Hikvision
  await redis.set("cam:1:rtsp_url", "rtsp://admin:REDACTED-LEAKED-PASSWORD%40@192.168.100.67:554/Streaming/Channels/101");
  await redis.set("cam:1:classes", JSON.stringify([0, 1, 2, 3, 5, 7, 14, 15, 16]));
  await redis.set("cam:1:conf", "0.35");
  await redis.set("cam:1:rev", "1");

  // Camera 2: V380 Pro
  await redis.set("cam:2:rtsp_url", "rtsp://192.168.100.16");
  await redis.set("cam:2:classes", JSON.stringify([0, 1, 2, 3, 5, 7, 14, 15, 16]));
  await redis.set("cam:2:conf", "0.35");
  await redis.set("cam:2:rev", "1");

  console.log("Redis keys for cam:1 and cam:2 configured successfully.");

  // Also publish camera:changed so any listeners are aware
  await redis.publish("camera:changed", JSON.stringify({ action: "updated", cameraId: 1 }));
  await redis.publish("camera:changed", JSON.stringify({ action: "updated", cameraId: 2 }));

  await redis.quit();
}

main().catch(console.error);

