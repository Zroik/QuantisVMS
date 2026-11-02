import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { cleanupOrphanedConsolidatorFiles } from "./consolidator.js";

describe("Hourly Consolidator & Orphan Cleanup", () => {
  let tempTestDir: string;

  beforeEach(async () => {
    tempTestDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vms-consolidator-test-"));
    await fsp.mkdir(path.join(tempTestDir, "tmp"), { recursive: true });
    await fsp.mkdir(path.join(tempTestDir, "raw", "cam1"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fsp.rm(tempTestDir, { recursive: true, force: true });
    } catch {}
  });

  it("cleans up stale temporary concat and consolidate files older than maxAge", async () => {
    const staleTmpTxt = path.join(tempTestDir, "tmp", "concat_1_20261102040000_123.txt");
    const staleTmpMp4 = path.join(tempTestDir, "tmp", "consolidate_1_20261102040000_123.mp4");
    const freshTmpMp4 = path.join(tempTestDir, "tmp", "consolidate_1_20261102040000_fresh.mp4");

    const staleRawTmp = path.join(tempTestDir, "raw", "cam1", "20261102040000_merged.mp4.tmp_123.mp4");
    const realRecording = path.join(tempTestDir, "raw", "cam1", "20261102_040000.mp4");

    await fsp.writeFile(staleTmpTxt, "file 'test'");
    await fsp.writeFile(staleTmpMp4, "dummy mp4 content");
    await fsp.writeFile(freshTmpMp4, "fresh mp4 content");
    await fsp.writeFile(staleRawTmp, "stale temp content");
    await fsp.writeFile(realRecording, "real video data");

    // Set mtime for stale files to 20 minutes ago
    const past = new Date(Date.now() - 20 * 60 * 1000);
    await fsp.utimes(staleTmpTxt, past, past);
    await fsp.utimes(staleTmpMp4, past, past);
    await fsp.utimes(staleRawTmp, past, past);

    // Run cleanup with 10 min threshold (600,000 ms)
    const cleaned = await cleanupOrphanedConsolidatorFiles(tempTestDir, 600000);

    // Stale files should be removed
    expect(cleaned).toBe(3);

    const exists = async (p: string) => {
      try {
        await fsp.stat(p);
        return true;
      } catch {
        return false;
      }
    };

    expect(await exists(staleTmpTxt)).toBe(false);
    expect(await exists(staleTmpMp4)).toBe(false);
    expect(await exists(staleRawTmp)).toBe(false);

    // Fresh files and real recording files must be preserved!
    expect(await exists(freshTmpMp4)).toBe(true);
    expect(await exists(realRecording)).toBe(true);
  });
});

