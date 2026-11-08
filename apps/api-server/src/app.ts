import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { authRouter } from "./auth/routes.js";
import { camerasRouter } from "./routes/cameras.js";
import { recordingsRouter } from "./routes/recordings.js";
import { eventsRouter } from "./routes/events.js";
import { vmafRouter } from "./routes/vmaf.js";
import { statsRouter } from "./routes/stats.js";
import { yoloRouter } from "./routes/yolo.js";
import { configRouter } from "./routes/config.js";
import { onvifRouter } from "./routes/onvif.js";
import { internalRouter } from "./routes/internal.js";
import { getDbPool } from "./db/connection.js";
import { getRedisClient } from "./redis/client.js";

export function createApp(): Express {
  const app = express();

  // Trust the single reverse proxy (nginx) so req.ip / X-Forwarded-For reflect
  // the real client for rate limiting. Set TRUST_PROXY=false when the API is
  // exposed directly with no proxy, or a numeric hop count when chained.
  if (process.env.TRUST_PROXY !== "false") {
    app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.WEB_ORIGIN || "http://localhost:5173",
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // Mount API routers
  app.use("/api/auth", authRouter);
  app.use("/api/cameras", camerasRouter);
  app.use("/api/recordings", recordingsRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/vmaf", vmafRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/yolo", yoloRouter);
  app.use("/api/config", configRouter);
  app.use("/api/onvif", onvifRouter);

  // Mount Internal hooks (MediaMTX auth, etc.)
  app.use("/internal", internalRouter);

  // Unauthenticated health & readiness probes (Spec §6.4, P-08)
  app.get("/healthz", async (req, res) => {
    if (req.query.check === "deps") {
      try {
        const pool = getDbPool();
        await pool.query("SELECT 1");
        const redis = getRedisClient();
        await redis.ping();
        res.json({ status: "ok", role: "liveness", db: "ok", redis: "ok" });
        return;
      } catch (err: any) {
        res.status(503).json({ status: "degraded", role: "liveness", error: err.message });
        return;
      }
    }
    res.json({ status: "ok", role: "liveness" });
  });

  app.get("/readyz", async (_req, res) => {
    try {
      const pool = getDbPool();
      await pool.query("SELECT 1");

      const redis = getRedisClient();
      const redisPing = await redis.ping();
      if (redisPing !== "PONG") {
        res.status(503).json({ status: "not_ready", error: "Redis not healthy" });
        return;
      }

      const { getMediaMtxApiBaseUrl, getMediaMtxAuthHeader } = await import("./mediamtx/client.js");
      const authHeader = getMediaMtxAuthHeader();
      if (!authHeader) {
        res.status(503).json({ status: "not_ready", error: "MediaMTX auth is not configured" });
        return;
      }
      const mtx = await fetch(`${getMediaMtxApiBaseUrl()}/v3/config/paths/list`, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(2000),
      });
      if (!mtx.ok) {
        res.status(503).json({ status: "not_ready", error: `MediaMTX API returned ${mtx.status}` });
        return;
      }

      res.status(200).json({ status: "ready", db: "ok", redis: "ok", mediamtx: "ok" });
    } catch (err: any) {
      res.status(503).json({ status: "not_ready", error: err.message });
    }
  });

  // 404 handler for API routes. Mounting on the "/api" prefix (rather than a
  // wildcard path) keeps this compatible with Express 5 / path-to-regexp v8,
  // which no longer accepts a bare "*" segment.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
  });

  // Global error handler ensuring JSON responses instead of default HTML 500 pages (B-M14)
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof err.status === "number" ? err.status : 500;
    const message = err.message || "Internal server error";
    res.status(status).json({
      error: message,
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    });
  });

  return app;
}
