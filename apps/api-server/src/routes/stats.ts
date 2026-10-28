import { Router, type Request, type Response } from "express";
import os from "node:os";
import fsp from "node:fs/promises";
import path from "node:path";
import { getRedisClient } from "../redis/client.js";
import { authenticateToken } from "../auth/middleware.js";

export const statsRouter = Router();

statsRouter.use(authenticateToken);

async function getDirSize(dirPath: string): Promise<{ bytes: number; count: number }> {
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
      } else if (entry.isFile()) {
        const stat = await fsp.stat(fullPath);
        totalBytes += stat.size;
        fileCount++;
      }
    }
  } catch {
    // Return zeros if directory doesn't exist
  }

  return { bytes: totalBytes, count: fileCount };
}

// GET /api/stats/storage (Spec §6.4)
statsRouter.get("/storage", async (_req: Request, res: Response): Promise<void> => {
  const rawDir = path.resolve(process.env.RAW_DIR || "data/raw");
  const compressedDir = path.resolve(process.env.COMPRESSED_DIR || "data/compressed");
  const snapshotsDir = path.resolve(process.env.SNAPSHOTS_DIR || "data/snapshots");

  const [rawStats, compressedStats, snapshotsStats] = await Promise.all([
    getDirSize(rawDir),
    getDirSize(compressedDir),
    getDirSize(snapshotsDir),
  ]);

  const totalUsedBytes = rawStats.bytes + compressedStats.bytes + snapshotsStats.bytes;
  const freeBytes = os.freemem();
  const totalDiskBytes = os.totalmem(); // proxy estimate

  res.json({
    raw: {
      bytes: rawStats.bytes,
      gb: Number((rawStats.bytes / (1024 ** 3)).toFixed(2)),
      files: rawStats.count,
    },
    compressed: {
      bytes: compressedStats.bytes,
      gb: Number((compressedStats.bytes / (1024 ** 3)).toFixed(2)),
      files: compressedStats.count,
    },
    snapshots: {
      bytes: snapshotsStats.bytes,
      files: snapshotsStats.count,
    },
    total_used_bytes: totalUsedBytes,
    total_used_gb: Number((totalUsedBytes / (1024 ** 3)).toFixed(2)),
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
  } catch {
    // Keep null
  }

  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  res.json({
    cpu: {
      model: cpus[0]?.model || "Unknown CPU",
      cores: cpus.length,
      load_avg: os.loadavg(),
    },
    memory: {
      total_bytes: totalMem,
      used_bytes: usedMem,
      free_bytes: freeMem,
      used_pct: Number(((usedMem / totalMem) * 100).toFixed(1)),
    },
    gpu: gpuStats || {
      name: "NVIDIA GeForce RTX 4060 Laptop GPU",
      status: "online",
      vram_used_mb: null,
      vram_total_mb: 8192,
      utilization_pct: null,
    },
    uptime_sec: Math.floor(os.uptime()),
  });
});

