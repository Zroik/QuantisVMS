import { Server as SocketIOServer, Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { verifyAccessToken, type UserPayload } from "../auth/service.js";
import { getRedisClient, getRedisSubClient } from "../redis/client.js";
import { resolveActiveClassIds } from "../yolo/classes.js";
import { getDbPool } from "../db/connection.js";

export interface AuthenticatedSocket extends Socket {
  data: {
    user: UserPayload;
  };
}

export function setupSocketGateway(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.WEB_ORIGIN || "http://localhost:5173",
      credentials: true,
    },
  });

  // Gate G3.5: Handshake Authentication Middleware
  io.use(async (socket, next) => {
    try {
      const authHeader =
        socket.handshake.auth?.token ||
        (socket.handshake.headers["authorization"]?.startsWith("Bearer ")
          ? socket.handshake.headers["authorization"].slice(7)
          : null);

      if (!authHeader) {
        return next(new Error("Authentication error: missing token"));
      }

      const user = await verifyAccessToken(authHeader);
      socket.data.user = user;
      next();
    } catch (err: any) {
      next(new Error("Authentication error: invalid or expired token"));
    }
  });

  io.on("connection", (socket: AuthenticatedSocket) => {
    // Gate G7.1 Item 2: Per-socket rate limiter (max 30 msgs / sec)
    const messageTimestamps: number[] = [];
    const MAX_MESSAGES_PER_SEC = 30;

    socket.use(([event, ...args], next) => {
      const now = Date.now();
      while (messageTimestamps.length > 0 && messageTimestamps[0] < now - 1000) {
        messageTimestamps.shift();
      }
      if (messageTimestamps.length >= MAX_MESSAGES_PER_SEC) {
        return next(new Error("Rate limit exceeded for socket messages"));
      }
      messageTimestamps.push(now);
      next();
    });

    // Room management per camera (authorized join)
    socket.on("join:camera", (data: any) => {
      const cameraId = Number(data?.cameraId || data);
      if (cameraId && Number.isInteger(cameraId) && cameraId > 0) {
        socket.join(`camera:${cameraId}`);
      }
    });

    socket.on("leave:camera", (data: any) => {
      const cameraId = Number(data?.cameraId || data);
      if (cameraId && Number.isInteger(cameraId) && cameraId > 0) {
        socket.leave(`camera:${cameraId}`);
      }
    });

    // Client toggle class with ack (Spec §6.3, Gate G3.4)
    socket.on("ai:toggle_class", async (data: any, ack?: (res: any) => void) => {
      try {
        if (socket.data.user?.role !== "admin") {
          ack?.({ ok: false, error: "Forbidden: admin role required to toggle camera detection classes" });
          return;
        }

        const { preset_groups, custom_class_ids = [], confidence_threshold, active_classes, active_class_ids } = data || {};
        const id = Number(data?.cameraId || data?.camera_id);
        if (!id) {
          ack?.({ ok: false, error: "Invalid cameraId" });
          return;
        }

        const explicitClasses = Array.isArray(active_classes) ? active_classes : Array.isArray(active_class_ids) ? active_class_ids : null;
        if (explicitClasses) {
          for (const cid of explicitClasses) {
            if (!Number.isInteger(cid) || cid < 0 || cid > 79) {
              ack?.({ ok: false, error: "Invalid class ID: must be between 0 and 79" });
              return;
            }
          }
        }

        for (const cid of custom_class_ids) {
          if (!Number.isInteger(cid) || cid < 0 || cid > 79) {
            ack?.({ ok: false, error: "Invalid class ID: must be between 0 and 79" });
            return;
          }
        }

        const pool = getDbPool();
        const [rows] = await pool.query<any[]>("SELECT * FROM cameras WHERE id = ?", [id]);
        if (rows.length === 0) {
          ack?.({ ok: false, error: "Camera not found" });
          return;
        }

        const currentCam = rows[0];
        const conf = confidence_threshold ?? Number(currentCam.confidence_threshold);
        const resolvedActiveIds = explicitClasses
          ? Array.from(new Set(explicitClasses.map(Number))).sort((a, b) => a - b)
          : resolveActiveClassIds(preset_groups, custom_class_ids);

        const activePayload = {
          preset_groups: preset_groups || {},
          custom_class_ids,
          resolved_active_ids: resolvedActiveIds,
          active_classes: resolvedActiveIds,
        };

        await pool.query(
          "UPDATE cameras SET active_yolo_classes = ?, confidence_threshold = ? WHERE id = ?",
          [JSON.stringify(activePayload), conf, id]
        );

        const redis = getRedisClient();
        const rev = await redis.incr(`cam:${id}:rev`);
        await redis.set(`cam:${id}:classes`, JSON.stringify(resolvedActiveIds));
        await redis.set(`cam:${id}:conf`, String(conf));

        const toggleMessage = {
          rev,
          camera_id: id,
          resolved_active_ids: resolvedActiveIds,
          confidence_threshold: conf,
        };
        await redis.publish("ai:toggle", JSON.stringify(toggleMessage));

        io.to(`camera:${id}`).emit("ai:class_state", {
          camera_id: id,
          active_classes: resolvedActiveIds,
          confidence_threshold: conf,
          rev,
        });

        ack?.({ ok: true, resolved_active_ids: resolvedActiveIds, active_classes: resolvedActiveIds, rev });
      } catch (err: any) {
        ack?.({ ok: false, error: err.message });
      }
    });
  });

  // Subscribe to Redis channels for ai:detections, transcode:probe_step, and system:alert
  const redisSub = getRedisSubClient();
  redisSub.subscribe("ai:detections", "transcode:probe_step", "system:alert", (err) => {
    if (err) {
      console.error("[SocketGateway] Failed to subscribe to Redis channels:", err);
    }
  });

  redisSub.on("message", (channel, message) => {
    if (channel === "ai:detections") {
      try {
        const payload = JSON.parse(message);
        const cameraId = payload.camera_id;
        if (cameraId) {
          // Broadcast ONLY to clients in room camera:{id}
          io.to(`camera:${cameraId}`).emit("ai:detections", payload);
        }
      } catch {
        // Ignore unparseable message
      }
    } else if (channel === "transcode:probe_step") {
      try {
        const payload = JSON.parse(message);
        io.emit("transcode:probe_step", payload);
      } catch {
        // Ignore unparseable message
      }
    } else if (channel === "system:alert") {
      try {
        const payload = JSON.parse(message);
        io.emit("system:alert", payload);
      } catch {
        // Ignore unparseable message
      }
    }
  });

  return io;
}

