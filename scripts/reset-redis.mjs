import Redis from "ioredis";

/**
 * Dev helper: point Redis routing keys at cameras configured through
 * SEED_CAM1_* / SEED_CAM2_* environment variables (see .env.example).
 * No credentials are ever committed here.
 */
const DEFAULT_CLASSES = JSON.stringify([0, 1, 2, 3, 5, 7, 14, 15, 16]);

async function main() {
  const redis = new Redis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_HOST_PORT) || 6380,
    password: process.env.REDIS_PASSWORD,
  });

  console.log("Connected to Redis...");

  const cameras = [
    { id: 1, url: process.env.SEED_CAM1_RTSP_URL },
    { id: 2, url: process.env.SEED_CAM2_RTSP_URL },
  ].filter((camera) => camera.url);

  if (cameras.length === 0) {
    console.error(
      "No cameras configured. Set SEED_CAM1_RTSP_URL / SEED_CAM2_RTSP_URL (see .env.example)."
    );
    await redis.quit();
    process.exit(1);
  }

  for (const camera of cameras) {
    await redis.set(`cam:${camera.id}:rtsp_url`, camera.url);
    await redis.set(`cam:${camera.id}:classes`, DEFAULT_CLASSES);
    await redis.set(`cam:${camera.id}:conf`, "0.35");
    await redis.set(`cam:${camera.id}:rev`, "1");
  }

  // Publish so any listeners are aware of the (re)configuration.
  await redis.publish("camera:changed", JSON.stringify({ action: "updated", cameraId: cameras[0].id }));

  console.log(`Redis keys configured for ${cameras.map((c) => `cam:${c.id}`).join(", ")}.`);
  await redis.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
