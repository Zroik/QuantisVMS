import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getDbPool } from "../db/connection.js";
import { getRedisClient } from "../redis/client.js";
import { authenticateToken, requireRole } from "../auth/middleware.js";
import { setSecurityTokenLifetimes } from "../auth/service.js";
import { isBlockedOutboundHost } from "../security/outbound.js";

export const configRouter = Router();

configRouter.use(authenticateToken);

const DEFAULT_CONFIG = {
  general: {
    instanceName: "Quantis Forensic Node 01",
    location: "Main Facility - Server Rack A",
    timezone: "Asia/Jakarta",
    ntpServer: "id.pool.ntp.org",
    language: "id",
    theme: "dark",
  },
  camera_streaming: {
    defaultTransport: "tcp",
    stunServer: "stun:stun.l.google.com:19302",
    internalRtspPort: 8554,
    whepPort: 8889,
    hlsPort: 8888,
  },
  ai_engine: {
    model: "yolov8n",
    engineVersion: "YOLOv8n (PyTorch FP32)",
    inferenceFps: 10,
    confidenceThreshold: 0.35,
    weights: {
      person: 3,
      vehicle: 2,
      pet: 1,
      other: 1,
    },
  },
  recording: {
    segmentDurationMin: 60, // default 1 jam
    durationPreset: "60", // "10", "30", "60", "120", or "custom"
    clockAligned: true,
    autoConsolidateHourly: true,
    snapshotFormat: "jpeg",
    snapshotQuality: 90,
  },
  compression: {
    preferredEncoder: "av1_nvenc",
    encoderPreset: "p5",
    targetVmafMean: 85.0,
    targetVmafP25: 81.0,
    vmafBackend: "cuda",
    compressionDelayHours: 24,
  },
  storage: {
    rawDir: "/data/raw",
    compressedDir: "/data/compressed",
    snapshotsDir: "/data/snapshots",
    tmpDir: "/data/tmp",
    highWatermarkPct: 85,
    criticalWatermarkPct: 95,
    retentionGraceHours: 24,
  },
  network: {
    httpPort: 8080,
    apiPort: 3000,
    rtspPort: 8554,
    whepPort: 8889,
    hlsPort: 8888,
    rtspConnectTimeoutMs: 5000,
    rtspReadTimeoutMs: 10000,
    allowedCors: ["http://localhost:8080", "http://127.0.0.1:8080"],
  },
  performance: {
    transcodeWorkers: 1,
    gpuVramCapMb: 6144,
    schedulerTickSec: 5,
  },
  security: {
    jwtAccessExpiryMin: 15,
    jwtRefreshExpiryDays: 7,
    encryptionAlgo: "AES-256-GCM",
    auditTrailEnabled: true,
  },
};

// Forensic audit log store for config actions ([PH6-02] in-memory + persistent MySQL)
interface ConfigAuditLog {
  id: number;
  timestamp: string;
  user: string;
  action: string;
  target: string;
  ip: string;
  status: string;
}

let nextAuditId = 1;
const forensicAuditLogs: ConfigAuditLog[] = [];

let auditTableEnsured = false;
async function ensureAuditTable(): Promise<void> {
  if (auditTableEnsured) return;
  try {
    const pool = getDbPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_audit_logs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        user VARCHAR(100) NOT NULL,
        action VARCHAR(100) NOT NULL,
        target VARCHAR(255) NOT NULL,
        ip VARCHAR(45) NOT NULL,
        status VARCHAR(20) NOT NULL,
        INDEX idx_audit_timestamp (timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    auditTableEnsured = true;
  } catch (err: any) {
    console.warn(`[AuditLog] Failed to ensure system_audit_logs table: ${err.message}`);
  }
}

async function recordAuditLog(log: Omit<ConfigAuditLog, "id">): Promise<void> {
  forensicAuditLogs.unshift({
    id: nextAuditId++,
    ...log,
  });
  if (forensicAuditLogs.length > 50) {
    forensicAuditLogs.length = 50;
  }

  try {
    await ensureAuditTable();
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO system_audit_logs (user, action, target, ip, status) VALUES (?, ?, ?, ?, ?)`,
      [log.user, log.action, log.target, log.ip, log.status]
    );
  } catch (err: any) {
    console.warn(`[AuditLog] Failed to insert audit log to DB: ${err.message}`);
  }
}

// Zod validation schemas for all system config sections
const GeneralConfigSchema = z.object({
  instanceName: z.string().min(1).max(100).optional(),
  location: z.string().max(200).optional(),
  timezone: z.string().min(1).max(50).optional(),
  ntpServer: z.string().min(1).max(100).optional(),
  language: z.enum(["id", "en"]).optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
}).passthrough();

const CameraStreamingConfigSchema = z.object({
  defaultTransport: z.enum(["tcp", "udp"]).optional(),
  stunServer: z.string().max(200).optional(),
  internalRtspPort: z.number().int().positive().max(65535).optional(),
  whepPort: z.number().int().positive().max(65535).optional(),
  hlsPort: z.number().int().positive().max(65535).optional(),
}).passthrough();

const AiEngineConfigSchema = z.object({
  model: z.string().min(1).max(50).optional(),
  engineVersion: z.string().max(100).optional(),
  inferenceFps: z.number().int().min(1).max(60).optional(),
  confidenceThreshold: z.number().min(0.01).max(1.0).optional(),
  weights: z.object({
    person: z.number().min(0).max(10).optional(),
    vehicle: z.number().min(0).max(10).optional(),
    pet: z.number().min(0).max(10).optional(),
    other: z.number().min(0).max(10).optional(),
  }).passthrough().optional(),
}).passthrough();

const RecordingConfigSchema = z.object({
  segmentDurationMin: z.number().int().positive().max(1440).optional(),
  durationPreset: z.union([z.string(), z.number()]).transform(String).optional(),
  clockAligned: z.boolean().optional(),
  autoConsolidateHourly: z.boolean().optional(),
  snapshotFormat: z.enum(["jpeg", "png", "webp"]).optional(),
  snapshotQuality: z.number().int().min(10).max(100).optional(),
  snapshotOverlay: z.boolean().optional(),
}).passthrough();

const CompressionConfigSchema = z.object({
  preferredEncoder: z.enum(["hevc_nvenc", "av1_nvenc", "libx265", "libsvtav1"]).optional(),
  encoderPreset: z.string().max(30).optional(),
  targetVmafMean: z.number().min(50).max(100).optional(),
  targetVmafP25: z.number().min(40).max(100).optional(),
  vmafBackend: z.string().max(30).optional(),
  compressionDelayHours: z.number().min(0).max(720).optional(),
  pixelFormat: z.string().max(50).optional(),
}).passthrough();

const StorageConfigSchema = z.object({
  rawDir: z.string().min(1).max(255).optional(),
  compressedDir: z.string().min(1).max(255).optional(),
  snapshotsDir: z.string().min(1).max(255).optional(),
  tmpDir: z.string().min(1).max(255).optional(),
  highWatermarkPct: z.number().min(10).max(99).optional(),
  criticalWatermarkPct: z.number().min(10).max(99).optional(),
  retentionGraceHours: z.number().min(0).max(720).optional(),
}).passthrough();

const NetworkConfigSchema = z.object({
  httpPort: z.number().int().positive().max(65535).optional(),
  apiPort: z.number().int().positive().max(65535).optional(),
  rtspPort: z.number().int().positive().max(65535).optional(),
  whepPort: z.number().int().positive().max(65535).optional(),
  hlsPort: z.number().int().positive().max(65535).optional(),
  rtspConnectTimeoutMs: z.number().int().positive().optional(),
  rtspReadTimeoutMs: z.number().int().positive().optional(),
  allowedCors: z.array(z.string()).optional(),
}).passthrough();

const PerformanceConfigSchema = z.object({
  transcodeWorkers: z.number().int().min(1).max(16).optional(),
  gpuVramCapMb: z.number().int().min(1024).max(65536).optional(),
  schedulerTickSec: z.number().int().min(1).max(60).optional(),
}).passthrough();

const SecurityConfigSchema = z.object({
  jwtAccessExpiryMin: z.number().int().min(5).max(1440).optional(),
  jwtRefreshExpiryDays: z.number().int().min(1).max(365).optional(),
  encryptionAlgo: z.string().max(50).optional(),
  auditTrailEnabled: z.boolean().optional(),
}).passthrough();

const sectionValidators: Record<string, z.ZodSchema> = {
  general: GeneralConfigSchema,
  camera_streaming: CameraStreamingConfigSchema,
  ai_engine: AiEngineConfigSchema,
  recording: RecordingConfigSchema,
  compression: CompressionConfigSchema,
  storage: StorageConfigSchema,
  network: NetworkConfigSchema,
  performance: PerformanceConfigSchema,
  security: SecurityConfigSchema,
};

// GET /api/config
configRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const pool = getDbPool();
    const [rows] = await pool.query<any[]>("SELECT config_key, config_value FROM system_config");
    
    const configMap: Record<string, any> = { ...DEFAULT_CONFIG };
    for (const row of rows) {
      if (row.config_key && row.config_value) {
        try {
          const parsed = typeof row.config_value === "string" ? JSON.parse(row.config_value) : row.config_value;
          configMap[row.config_key] = { ...(configMap[row.config_key] || {}), ...parsed };
        } catch {
          // ignore corrupted value
        }
      }
    }

    res.json({
      success: true,
      config: configMap,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, config: DEFAULT_CONFIG });
  }
});

// PUT /api/config
configRouter.put("/", requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const pool = getDbPool();
    const updates = req.body;

    if (!updates || typeof updates !== "object") {
      res.status(400).json({ success: false, error: "Invalid configuration payload" });
      return;
    }

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      res.status(400).json({ success: false, error: "Configuration payload cannot be empty" });
      return;
    }

    // Handle Factory Reset ONLY if explicitly requested with { reset: true }
    if (updates.reset === true) {
      await ensureAuditTable();
      const user = (req as any).user?.username || "admin";
      const ip = String(req.ip || req.socket.remoteAddress || "127.0.0.1");
      const nowIso = new Date().toISOString();

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query("DELETE FROM system_config");
        await conn.query(
          `INSERT INTO system_audit_logs (user, action, target, ip, status) VALUES (?, ?, ?, ?, ?)`,
          [user, "CONFIG_FACTORY_RESET", "Semua konfigurasi dikembalikan ke pengaturan pabrik", ip, "SUCCESS"]
        );
        await conn.commit();
      } catch (txErr) {
        await conn.rollback();
        throw txErr;
      } finally {
        conn.release();
      }

      forensicAuditLogs.unshift({
        id: nextAuditId++,
        timestamp: nowIso,
        user,
        action: "CONFIG_FACTORY_RESET",
        target: "Semua konfigurasi dikembalikan ke pengaturan pabrik",
        ip,
        status: "SUCCESS",
      });
      if (forensicAuditLogs.length > 50) forensicAuditLogs.length = 50;

      setSecurityTokenLifetimes(null);

      try {
        const redis = getRedisClient();
        await redis.publish("system:config_changed", JSON.stringify({ reset: true, config: DEFAULT_CONFIG }));
      } catch (redisErr: any) {
        console.warn("[Config] Redis publish failed on factory reset:", redisErr?.message);
      }

      res.json({
        success: true,
        message: "Konfigurasi sistem berhasil di-reset ke pengaturan pabrik.",
        config: DEFAULT_CONFIG,
      });
      return;
    }

    const validSections = [
      "general",
      "camera_streaming",
      "ai_engine",
      "recording",
      "compression",
      "storage",
      "network",
      "performance",
      "security",
    ];

    const validatedUpdates: Record<string, any> = {};
    const updatedSectionNames: string[] = [];

    for (const section of validSections) {
      if (updates[section] && typeof updates[section] === "object") {
        const validator = sectionValidators[section];
        if (validator) {
          const parseResult = validator.safeParse(updates[section]);
          if (!parseResult.success) {
            const firstErr = parseResult.error.issues[0];
            res.status(400).json({
              success: false,
              error: `Validasi gagal pada [${section}.${firstErr.path.join(".")}]: ${firstErr.message}`,
            });
            return;
          }
          validatedUpdates[section] = parseResult.data;
        } else {
          validatedUpdates[section] = updates[section];
        }
        updatedSectionNames.push(section);
      }
    }

    const user = (req as any).user?.username || "admin";
    const ip = String(req.ip || req.socket.remoteAddress || "127.0.0.1");
    const nowIso = new Date().toISOString();

    if (updatedSectionNames.length > 0) {
      await ensureAuditTable();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const section of updatedSectionNames) {
          const valJson = JSON.stringify(validatedUpdates[section]);
          await conn.query(
            `INSERT INTO system_config (config_key, config_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW(3)`,
            [section, valJson]
          );
        }
        await conn.query(
          `INSERT INTO system_audit_logs (user, action, target, ip, status) VALUES (?, ?, ?, ?, ?)`,
          [user, "CONFIG_UPDATE", `Bagian diperbarui: ${updatedSectionNames.join(", ")}`, ip, "SUCCESS"]
        );
        await conn.commit();
      } catch (txErr) {
        await conn.rollback();
        throw txErr;
      } finally {
        conn.release();
      }

      forensicAuditLogs.unshift({
        id: nextAuditId++,
        timestamp: nowIso,
        user,
        action: "CONFIG_UPDATE",
        target: `Bagian diperbarui: ${updatedSectionNames.join(", ")}`,
        ip,
        status: "SUCCESS",
      });
      if (forensicAuditLogs.length > 50) forensicAuditLogs.length = 50;

      if (validatedUpdates.security) {
        setSecurityTokenLifetimes({
          jwtAccessExpiryMin: validatedUpdates.security.jwtAccessExpiryMin,
          jwtRefreshExpiryDays: validatedUpdates.security.jwtRefreshExpiryDays,
        });
      }
    }

    // Publish to redis so services can react dynamically
    try {
      const redis = getRedisClient();
      await redis.publish("system:config_changed", JSON.stringify(validatedUpdates));
    } catch (redisErr: any) {
      console.warn("[Config] Redis publish failed on config update:", redisErr?.message);
    }

    // Return merged config
    const [rows] = await pool.query<any[]>("SELECT config_key, config_value FROM system_config");
    const configMap: Record<string, any> = { ...DEFAULT_CONFIG };
    for (const row of rows) {
      if (row.config_key && row.config_value) {
        try {
          const parsed = typeof row.config_value === "string" ? JSON.parse(row.config_value) : row.config_value;
          configMap[row.config_key] = { ...(configMap[row.config_key] || {}), ...parsed };
        } catch {}
      }
    }

    res.json({
      success: true,
      message: "Konfigurasi sistem berhasil disimpan.",
      config: configMap,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/config/audit-logs & /api/config/audit ([PH6-02 / SEC-04] requireRole("admin") + MySQL persistence)
async function handleGetAuditLogs(_req: Request, res: Response): Promise<void> {
  try {
    const pool = getDbPool();
    await ensureAuditTable();
    const [rows] = await pool.query<any[]>(
      `SELECT id, DATE_FORMAT(timestamp, '%Y-%m-%dT%H:%i:%s.000Z') AS timestamp, user, action, target, ip, status
       FROM system_audit_logs
       ORDER BY id DESC
       LIMIT 50`
    );
    res.json({
      success: true,
      source: "db",
      degraded: false,
      logs: Array.isArray(rows) ? rows : [],
    });
    return;
  } catch (err: any) {
    console.warn(`[AuditLog] Database audit log query failed; returning degraded memory fallback: ${err.message}`);
    res.json({
      success: true,
      source: "memory",
      degraded: true,
      warning: "Database audit log unavailable",
      logs: forensicAuditLogs,
    });
  }
}

configRouter.get("/audit-logs", requireRole("admin"), handleGetAuditLogs);
configRouter.get("/audit", requireRole("admin"), handleGetAuditLogs);

// POST /api/config/sync-ntp
configRouter.post("/sync-ntp", requireRole("admin"), async (req: Request, res: Response) => {
  const { server = "id.pool.ntp.org" } = req.body;
  const startTime = Date.now();

  if (isBlockedOutboundHost(String(server))) {
    res.status(400).json({ success: false, error: "NTP server target is not allowed" });
    return;
  }

  try {
    const dgram = await import("node:dgram");
    const socket = dgram.createSocket("udp4");
    const packet = Buffer.alloc(48);
    // LI = 0, VN = 3, Mode = 3 (client) -> 0x1B
    packet[0] = 0x1b;

    await new Promise<{ latencyMs: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        try { socket.close(); } catch {}
        reject(new Error("SNTP query timeout (3000ms)"));
      }, 3000);

      socket.on("message", () => {
        clearTimeout(timer);
        try { socket.close(); } catch {}
        resolve({ latencyMs: Date.now() - startTime });
      });

      socket.on("error", (err) => {
        clearTimeout(timer);
        try { socket.close(); } catch {}
        reject(err);
      });

      socket.send(packet, 0, packet.length, 123, server, (err) => {
        if (err) {
          clearTimeout(timer);
          try { socket.close(); } catch {}
          reject(err);
        }
      });
    });

    const latency = Date.now() - startTime;
    res.json({
      success: true,
      server,
      latencyMs: latency,
      message: `NTP tersinkronisasi ke ${server} (SNTP respons diterima, latensi ${latency} ms)`,
    });
  } catch (err: any) {
    res.status(502).json({
      success: false,
      server,
      error: `Gagal menyinkronkan ke server NTP ${server}: ${err.message}`,
    });
  }
});

// POST /api/config/test-camera-ping
configRouter.post("/test-camera-ping", requireRole("admin"), async (req: Request, res: Response) => {
  const { host, port = 554 } = req.body;
  if (!host || typeof host !== "string" || host.trim().length === 0) {
    res.status(400).json({ success: false, error: "Host/IP kamera wajib diisi" });
    return;
  }
  if (isBlockedOutboundHost(host)) {
    res.status(400).json({ success: false, error: "Target host is not allowed" });
    return;
  }
  const cleanPort = Number(port);
  if (isNaN(cleanPort) || cleanPort < 1 || cleanPort > 65535) {
    res.status(400).json({ success: false, error: "Port tidak valid (1-65535)" });
    return;
  }

  // Fast tcp connection probe
  const net = await import("node:net");
  const startTime = Date.now();
  const socket = new net.Socket();
  socket.setTimeout(2500);

  let responded = false;
  socket.connect(cleanPort, host.trim(), () => {
    if (responded) return;
    responded = true;
    const latency = Date.now() - startTime;
    socket.destroy();
    res.json({
      success: true,
      host: host.trim(),
      port: cleanPort,
      reachable: true,
      latencyMs: latency,
      message: `Berhasil tersambung ke ${host.trim()}:${cleanPort} (${latency} ms)`,
    });
  });

  socket.on("error", (err) => {
    if (responded) return;
    responded = true;
    socket.destroy();
    res.json({
      success: false,
      host: host.trim(),
      port: cleanPort,
      reachable: false,
      latencyMs: Date.now() - startTime,
      message: `Gagal tersambung ke ${host.trim()}:${cleanPort}: ${err.message}`,
    });
  });

  socket.on("timeout", () => {
    if (responded) return;
    responded = true;
    socket.destroy();
    res.json({
      success: false,
      host: host.trim(),
      port: cleanPort,
      reachable: false,
      latencyMs: Date.now() - startTime,
      message: `Batas waktu (timeout) terlampaui saat menghubungi ${host.trim()}:${cleanPort}`,
    });
  });
});

