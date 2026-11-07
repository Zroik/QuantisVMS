import { Router, type Request, type Response } from "express";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getRedisClient } from "../redis/client.js";
import { getDbPool } from "../db/connection.js";
import { authenticateToken, requireRole } from "../auth/middleware.js";
import { transitionRecordingStatus } from "../db/transitions.js";

export const statsRouter = Router();

statsRouter.use(authenticateToken);

const dirSizeCache = new Map<string, { bytes: number; count: number; cachedAt: number }>();

async function getDirSize(dirPath: string): Promise<{ bytes: number; count: number }> {
  const now = Date.now();
  const cached = dirSizeCache.get(dirPath);
  if (cached && now - cached.cachedAt < 15000) {
    return { bytes: cached.bytes, count: cached.count };
  }

  let totalBytes = 0;
  let fileCount = 0;

  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const sub = await getDirSize(fullPath);
        totalBytes += sub.bytes;
        fileCount += sub.count;
      } else if (entry.isFile() && !entry.name.startsWith(".")) {
        const stat = await fsp.stat(fullPath);
        totalBytes += stat.size;
        fileCount++;
      }
    }
  } catch {
    // Return zeros if directory doesn't exist
  }

  const result = { bytes: totalBytes, count: fileCount };
  dirSizeCache.set(dirPath, { ...result, cachedAt: now });
  return result;
}

// CPU tick measurement for real CPU utilization
let lastCpuMeasure = {
  idle: 0,
  total: 0,
  time: Date.now(),
};
let lastCpuPercent: number | null = null;

function getCpuTickDelta(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    for (const [type, time] of Object.entries(cpu.times)) {
      total += time;
      if (type === "idle") {
        idle += time;
      }
    }
  }

  const idleDelta = idle - lastCpuMeasure.idle;
  const totalDelta = total - lastCpuMeasure.total;

  lastCpuMeasure = { idle, total, time: Date.now() };

  if (totalDelta <= 0) {
    return lastCpuPercent ?? 0;
  }
  const used = Math.max(0.5, Math.min(100, 100 - (idleDelta / totalDelta) * 100));
  const rounded = Number(used.toFixed(1));
  lastCpuPercent = rounded;
  return rounded;
}

// Real filesystem storage statistics
async function getRealStorageStats(): Promise<{
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
  rawBytes: number;
  compressedBytes: number;
  snapshotsBytes: number;
  otherBytes: number;
  storageUnavailable: boolean;
}> {
  let dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
  if (!dataDir || !fs.existsSync(dataDir)) {
    if (fs.existsSync("/data")) {
      dataDir = "/data";
    } else {
      dataDir = path.resolve("data");
    }
  }

  const rawDir = path.resolve(process.env.RAW_DIR || path.join(dataDir, "raw"));
  const compDir = path.resolve(process.env.COMPRESSED_DIR || path.join(dataDir, "compressed"));
  const snapDir = path.resolve(process.env.SNAPSHOTS_DIR || path.join(dataDir, "snapshots"));

  let totalBytes = 0;
  let freeBytes = 0;
  let storageUnavailable = false;

  try {
    const stat = await fsp.statfs(dataDir);
    totalBytes = stat.blocks * stat.bsize;
    freeBytes = stat.bavail * stat.bsize;
  } catch {
    totalBytes = 0;
    freeBytes = 0;
    storageUnavailable = true;
  }

  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const usedPercent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0;

  const [raw, comp, snap] = await Promise.all([
    getDirSize(rawDir),
    getDirSize(compDir),
    getDirSize(snapDir),
  ]);

  const vmsUsed = raw.bytes + comp.bytes + snap.bytes;
  const otherBytes = Math.max(0, usedBytes - vmsUsed);

  return {
    totalBytes,
    usedBytes,
    freeBytes,
    usedPercent,
    rawBytes: raw.bytes,
    compressedBytes: comp.bytes,
    snapshotsBytes: snap.bytes,
    otherBytes,
    storageUnavailable,
  };
}

// Real-Time per-camera Ingest Bitrate Tracker from MediaMTX
const cameraBitrateHistory = new Map<string, { lastBytes: number; lastTime: number; mbps: number; kbps: number }>();

async function getMediaMtxNetworkStats(): Promise<{
  totalIngestMbps: number;
  totalReceivedBytes: number;
  streams: Array<{
    name: string;
    ready: boolean;
    codec: string;
    resolution: string;
    bitrateMbps: number;
    bitrateKbps: number;
    readersCount: number;
    inboundBytes: number;
  }>;
}> {
  // Query active cameras from database so only valid configured cameras are reported
  let dbCameras: Array<{ id: number; name: string }> = [];
  try {
    const pool = getDbPool();
    const [cams] = await pool.query<any[]>("SELECT id, name FROM cameras WHERE enabled = 1 AND parent_camera_id IS NULL");
    dbCameras = cams;
  } catch {
    dbCameras = [{ id: 1, name: "Hikvision CCTV" }, { id: 2, name: "v380 pro" }];
  }

  try {
    const mediamtxSecret = process.env.MEDIAMTX_AUTH_SECRET;
    const authHeader = mediamtxSecret ? "Basic " + Buffer.from(`internal_reader:${mediamtxSecret}`).toString("base64") : "";
    const res = await fetch(`${process.env.MEDIAMTX_API_BASE || "http://mediamtx:9997"}/v3/paths/list`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(1500),
    });

    if (!res.ok) throw new Error("MediaMTX API error");
    const data = (await res.json()) as any;
    const items: any[] = data.items || [];
    const itemMap = new Map<string, any>(items.map((it: any) => [it.name, it]));

    const now = Date.now();
    let totalIngestMbps = 0;
    let totalReceivedBytes = 0;

    const streams = dbCameras.map((cam) => {
      const streamName = `cam${cam.id}`;
      const it = itemMap.get(streamName);

      if (!it || !it.ready) {
        return {
          name: streamName,
          ready: false,
          codec: "unknown",
          resolution: "unknown",
          bitrateMbps: 0,
          bitrateKbps: 0,
          readersCount: 0,
          inboundBytes: 0,
        };
      }

      const currentInbound = Number(it.inboundBytes || 0);
      totalReceivedBytes += currentInbound;

      const track = it.tracks2?.[0];
      const width = track?.codecProps?.width;
      const height = track?.codecProps?.height;

      let bitrateMbps = 0;
      let bitrateKbps = 0;

      const prev = cameraBitrateHistory.get(streamName);
      if (prev && currentInbound >= prev.lastBytes) {
        const dtSec = Math.max(0.5, (now - prev.lastTime) / 1000);
        const deltaBytes = currentInbound - prev.lastBytes;
        bitrateMbps = Number(((deltaBytes * 8) / (dtSec * 1024 * 1024)).toFixed(2));
        bitrateKbps = Math.round((deltaBytes * 8) / (dtSec * 1024));
      } else {
        // Initial baseline based on actual camera configurations
        bitrateMbps = 0;
        bitrateKbps = Math.round(bitrateMbps * 1024);
      }

      cameraBitrateHistory.set(streamName, {
        lastBytes: currentInbound,
        lastTime: now,
        mbps: bitrateMbps,
        kbps: bitrateKbps,
      });

      totalIngestMbps += bitrateMbps;

      return {
        name: streamName,
        ready: true,
        codec: track?.codec || it.tracks?.[0] || "H.264",
        resolution: width && height ? `${width}x${height}` : "unknown",
        bitrateMbps,
        bitrateKbps,
        readersCount: it.readers?.length || 0,
        inboundBytes: currentInbound,
      };
    });

    return {
      totalIngestMbps: Number(totalIngestMbps.toFixed(2)),
      totalReceivedBytes,
      streams,
    };
  } catch {
    // If MediaMTX is unavailable, report offline state for DB cameras
    return {
      totalIngestMbps: 0,
      totalReceivedBytes: 0,
      streams: dbCameras.map((c) => ({
        name: `cam${c.id}`,
        ready: false,
        codec: "H.264",
        resolution: "unknown",
        bitrateMbps: 0,
        bitrateKbps: 0,
        readersCount: 0,
        inboundBytes: 0,
      })),
    };
  }
}

// GET /api/stats (Aggregated statistics for telemetry store & hardware monitor)
statsRouter.get("/", async (_req: Request, res: Response): Promise<void> => {
  const redis = getRedisClient();
  let gpuStats: any = null;

  try {
    const rawGpu = await redis.get("hw:gpu");
    if (rawGpu) {
      gpuStats = JSON.parse(rawGpu);
    }
  } catch {
    // Keep null
  }

  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || "unknown";
  const cpuThreads = cpus.length;
  const cpuCores = cpus.length;
  const cpuPct = getCpuTickDelta();

  // 1. WSL2 / Local container memory
  const wslTotalMem = os.totalmem();
  const wslFreeMem = os.freemem();
  const wslUsedMem = Math.max(0, wslTotalMem - wslFreeMem);
  const wslRamPct = Number(((wslUsedMem / wslTotalMem) * 100).toFixed(1));

  // 2. Windows host memory (from host_ram.json publisher)
  let hostTotalMem = os.totalmem();
  let hostUsedMem = os.totalmem() - os.freemem();
  let hostFreeMem = hostTotalMem - hostUsedMem;
  let hostRamPct = Number(((hostUsedMem / hostTotalMem) * 100).toFixed(1));

  try {
    let hostRamFile = path.resolve(process.env.DATA_DIR || "/data", "host_ram.json");
    if (!fs.existsSync(hostRamFile)) {
      hostRamFile = path.resolve("data", "host_ram.json");
    }
    if (fs.existsSync(hostRamFile)) {
      const raw = await fsp.readFile(hostRamFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.totalBytes && Date.now() - (parsed.timestamp || 0) < 30000) {
        hostTotalMem = Number(parsed.totalBytes);
        hostFreeMem = Number(parsed.freeBytes || 0);
        hostUsedMem = Number(parsed.usedBytes || (hostTotalMem - hostFreeMem));
        hostRamPct = Number(parsed.percent || Number(((hostUsedMem / hostTotalMem) * 100).toFixed(1)));
      }
    }
  } catch {
    // Keep fallback
  }

  const [storage, network] = await Promise.all([
    getRealStorageStats(),
    getMediaMtxNetworkStats(),
  ]);

  const encUtil = Number(gpuStats?.enc_util ?? 0);
  const decUtil = Number(gpuStats?.dec_util ?? 0);
  const nvencActive = encUtil > 0 || decUtil > 0;

  const pool = getDbPool();
  const [queueRows] = await pool.query<any[]>(
    "SELECT status, COUNT(*) AS c FROM recordings WHERE status IN ('QUEUED','PROBING','ENCODING','VERIFYING') GROUP BY status"
  );
  const queueCounts: Record<string, number> = {};
  for (const row of queueRows) queueCounts[row.status] = Number(row.c);

  const [savingsRows] = await pool.query<any[]>(
    "SELECT COALESCE(SUM(raw_size_bytes),0) AS raw, COALESCE(SUM(compressed_size_bytes),0) AS comp FROM recordings WHERE status = 'COMPLETED'"
  );
  const completedRawBytes = Number(savingsRows[0]?.raw || 0);
  const completedCompressedBytes = Number(savingsRows[0]?.comp || 0);

  res.json({
    hardware: {
      cpuModel,
      cpuCores,
      cpuThreads,
      cpuPercent: cpuPct,
      ramPercent: hostRamPct,
      ramUsedBytes: hostUsedMem,
      ramTotalBytes: hostTotalMem,
      wslRamPercent: wslRamPct,
      wslRamUsedBytes: wslUsedMem,
      wslRamTotalBytes: wslTotalMem,
      gpuName: gpuStats?.name ?? "unknown",
      gpuUtil: gpuStats?.gpu_util ?? null,
      vramUsedMb: gpuStats?.vram_used_mb ?? null,
      vramTotalMb: gpuStats?.vram_total_mb ?? null,
      gpuTemp: gpuStats?.temp_c ?? null,
      encUtil,
      decUtil,
      nvencActive,
      diskUsedBytes: storage.usedBytes,
      diskTotalBytes: storage.totalBytes,
      diskFreeBytes: storage.freeBytes,
      diskPercent: storage.usedPercent,
      storageUnavailable: storage.storageUnavailable,
      diskBreakdown: {
        rawBytes: storage.rawBytes,
        compressedBytes: storage.compressedBytes,
        snapshotsBytes: storage.snapshotsBytes,
        otherBytes: storage.otherBytes,
        freeBytes: storage.freeBytes,
      },
      network,
    },
    queue: {
      queued: queueCounts.QUEUED || 0,
      probing: queueCounts.PROBING || 0,
      encoding: queueCounts.ENCODING || 0,
      verifying: queueCounts.VERIFYING || 0,
    },
    savings: {
      totalRawBytes: completedRawBytes,
      totalCompressedBytes: completedCompressedBytes,
      savingsPct: completedRawBytes > 0 && completedCompressedBytes > 0
        ? Number((((completedRawBytes - completedCompressedBytes) / completedRawBytes) * 100).toFixed(1))
        : 0,
    },
  });
});

// GET /api/stats/storage (Spec §6.4)
statsRouter.get("/storage", async (_req: Request, res: Response): Promise<void> => {
  const storage = await getRealStorageStats();

  res.json({
    raw: {
      bytes: storage.rawBytes,
      gb: Number((storage.rawBytes / (1024 ** 3)).toFixed(2)),
    },
    compressed: {
      bytes: storage.compressedBytes,
      gb: Number((storage.compressedBytes / (1024 ** 3)).toFixed(2)),
    },
    snapshots: {
      bytes: storage.snapshotsBytes,
      gb: Number((storage.snapshotsBytes / (1024 ** 3)).toFixed(2)),
    },
    total_disk_bytes: storage.totalBytes,
    total_disk_gb: Number((storage.totalBytes / (1024 ** 3)).toFixed(2)),
    total_used_bytes: storage.usedBytes,
    total_used_gb: Number((storage.usedBytes / (1024 ** 3)).toFixed(2)),
    free_bytes: storage.freeBytes,
    free_gb: Number((storage.freeBytes / (1024 ** 3)).toFixed(2)),
    used_percent: storage.usedPercent,
    storage_unavailable: storage.storageUnavailable,
  });
});

// GET /api/stats/hardware (Spec §6.4: GPU + disk + CPU/RAM)
statsRouter.get("/hardware", async (_req: Request, res: Response): Promise<void> => {
  const redis = getRedisClient();
  let gpuStats: any = null;

  try {
    const rawGpu = await redis.get("hw:gpu");
    if (rawGpu) {
      gpuStats = JSON.parse(rawGpu);
    }
  } catch { }

  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  res.json({
    cpu: {
      model: cpus[0]?.model || "unknown",
      cores: cpus.length,
      load_avg: os.loadavg(),
      percent: getCpuTickDelta(),
    },
    memory: {
      total_bytes: totalMem,
      used_bytes: usedMem,
      free_bytes: freeMem,
      used_pct: Number(((usedMem / totalMem) * 100).toFixed(1)),
    },
    gpu: gpuStats || {
      name: gpuStats?.name ?? "unknown",
      status: "online",
      vram_used_mb: gpuStats?.vram_used_mb ?? null,
      vram_total_mb: gpuStats?.vram_total_mb ?? null,
      gpu_util: gpuStats?.gpu_util ?? null,
      temp_c: gpuStats?.temp_c ?? null,
    },
    uptime_sec: Math.floor(os.uptime()),
  });
});

// GET /api/stats/vmaf-probes (Historical VMAF probe logs & aggregated curve)
statsRouter.get("/vmaf-probes", async (req: Request, res: Response): Promise<void> => {
  try {
    const pool = getDbPool();
    const cameraId = req.query.cameraId ? Number(req.query.cameraId) : null;

    let query = `
      SELECT p.id, p.recording_id, r.camera_id, c.name as camera_name,
             p.iteration_num, CAST(p.tested_cq AS FLOAT) as tested_cq,
             p.sample_vmaf_mean, p.sample_vmaf_p25, p.backend,
             p.duration_ms, p.created_at
      FROM vmaf_probe_logs p
      JOIN recordings r ON r.id = p.recording_id
      JOIN cameras c ON c.id = r.camera_id
    `;
    const params: any[] = [];
    if (cameraId && Number.isInteger(cameraId) && cameraId > 0) {
      query += ` WHERE r.camera_id = ? `;
      params.push(cameraId);
    }
    query += ` ORDER BY p.id DESC LIMIT 50 `;

    const [rows] = await pool.query<any[]>(query, params);

    // Get aggregated curve per CQ value
    let curveQuery = `
      SELECT CAST(p.tested_cq AS FLOAT) as cq,
             ROUND(AVG(p.sample_vmaf_mean), 2) as avg_vmaf_mean,
             ROUND(AVG(p.sample_vmaf_p25), 2) as avg_vmaf_p25,
             COUNT(*) as sample_count
      FROM vmaf_probe_logs p
      JOIN recordings r ON r.id = p.recording_id
    `;
    const curveParams: any[] = [];
    if (cameraId && Number.isInteger(cameraId) && cameraId > 0) {
      curveQuery += ` WHERE r.camera_id = ? `;
      curveParams.push(cameraId);
    }
    curveQuery += ` GROUP BY p.tested_cq ORDER BY p.tested_cq ASC `;

    const [curveRows] = await pool.query<any[]>(curveQuery, curveParams);

    // Queue status counts from database
    const [queueCounts] = await pool.query<any[]>(`
      SELECT status, COUNT(*) as cnt
      FROM recordings
      WHERE status IN ('QUEUED', 'PROBING', 'ENCODING', 'VERIFYING')
      GROUP BY status
    `);

    const qMap: Record<string, number> = {
      QUEUED: 0,
      PROBING: 0,
      ENCODING: 0,
      VERIFYING: 0,
    };
    for (const q of queueCounts) {
      qMap[q.status] = Number(q.cnt);
    }

    res.json({
      probes: rows,
      curve: curveRows.map((c: any) => ({
        cq: Number(c.cq),
        vmaf: Number(c.avg_vmaf_mean),
        vmaf_p25: Number(c.avg_vmaf_p25),
        sample_count: Number(c.sample_count),
        gateMet: Number(c.avg_vmaf_mean) >= 80.0,
      })),
      queue: {
        queued: qMap.QUEUED,
        probing: qMap.PROBING,
        encoding: qMap.ENCODING,
        verifying: qMap.VERIFYING,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch VMAF probes: " + err.message });
  }
});

// POST /api/stats/trigger-probe (Manually enqueue latest RAW recording for probing)
statsRouter.post("/trigger-probe", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const pool = getDbPool();
    const redis = getRedisClient();
    const cameraId = req.body?.cameraId ? Number(req.body.cameraId) : null;

    let q = "SELECT id, camera_id, raw_path FROM recordings WHERE status = 'RAW'";
    const p: any[] = [];
    if (cameraId) {
      q += " AND camera_id = ?";
      p.push(cameraId);
    }
    q += " ORDER BY id DESC LIMIT 1";

    const [rows] = await pool.query<any[]>(q, p);
    if (rows.length === 0) {
      res.status(404).json({ error: "Tidak ada rekaman mentah yang siap di-probe." });
      return;
    }

    const rec = rows[0];
    const { Queue } = await import("bullmq");
    const queue = new Queue("transcode", { connection: redis });
    try {
      const existing = await queue.getJob(`rec-${rec.id}`);
      if (existing) {
        res.status(409).json({ error: `Recording #${rec.id} is already queued` });
        return;
      }
      await queue.add(
        "transcode",
        {
          recordingId: rec.id,
          cameraId: rec.camera_id,
          rawPath: rec.raw_path,
        },
        {
          jobId: `rec-${rec.id}`,
          priority: 1,
          attempts: 3,
          removeOnComplete: true,
          removeOnFail: true,
        }
      );
      await transitionRecordingStatus(pool, rec.id, "QUEUED");
    } catch (err) {
      await queue.remove(`rec-${rec.id}`).catch(() => {});
      throw err;
    } finally {
      await queue.close();
    }

    res.json({
      ok: true,
      recordingId: rec.id,
      message: `Rekaman #${rec.id} berhasil dimasukkan ke antrean proses VMAF.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Gagal memicu probe: " + err.message });
  }
});
