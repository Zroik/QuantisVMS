import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { authRouter } from "./auth/routes.js";
import { camerasRouter } from "./routes/cameras.js";
import { recordingsRouter } from "./routes/recordings.js";
import { eventsRouter } from "./routes/events.js";
import { statsRouter } from "./routes/stats.js";
import { yoloRouter } from "./routes/yolo.js";
import { internalRouter } from "./routes/internal.js";
import { getDbPool } from "./db/connection.js";
import { getRedisClient } from "./redis/client.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.WEB_ORIGIN || "http://localhost:5173",
      credentials: true,
    })
  );
  app.use(express.json());

  // Mount API routers
  app.use("/api/auth", authRouter);
  app.use("/api/cameras", camerasRouter);
  app.use("/api/recordings", recordingsRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/yolo", yoloRouter);

  // Mount Internal hooks (MediaMTX auth, etc.)
  app.use("/internal", internalRouter);

  // Unauthenticated health & readiness probes (Spec §6.4)
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/readyz", async (_req, res) => {
    try {
      const pool = getDbPool();
      await pool.query("SELECT 1");

      const redis = getRedisClient();
      const redisPing = await redis.ping();

      if (redisPing === "PONG") {
        res.status(200).json({ status: "ready", db: "ok", redis: "ok" });
        return;
      }
      res.status(503).json({ status: "not_ready", error: "Redis not healthy" });
    } catch (err: any) {
      res.status(503).json({ status: "not_ready", error: err.message });
    }
  });

  return app;
}
