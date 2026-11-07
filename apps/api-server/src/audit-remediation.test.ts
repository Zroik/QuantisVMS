import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import {
  signMediaTicket,
  decodeMediaTicket,
  verifyMediaTicket,
  setSecurityTokenLifetimes,
  getSecurityTokenLifetimes,
} from "./auth/service.js";
import { isPathSafeAsync, clearPathSafetyCache } from "./routes/recordings.js";
import {
  calculateWeightedVmafMean,
  resolveSelectedEncoder,
  processRecordingTranscode,
} from "./transcode/pipeline.js";
import {
  deriveCredentialKey,
  encryptRtspUrlForRedis,
  decryptRtspUrlFromRedis,
} from "./crypto/credentials.js";

describe("2026-11-06 Deep Audit Remediations Unit Suite", () => {
  beforeEach(() => {
    clearPathSafetyCache();
    setSecurityTokenLifetimes(null);
  });

  it("[PB-04 / SEC-01] issues and verifies recording-scoped 60s media tickets and rejects wrong recordingId", () => {
    const ticket = signMediaTicket(1, 77, 60, "admin", "admin");

    expect(verifyMediaTicket(ticket, 77)).toBe(true);
    const decoded = decodeMediaTicket(ticket, 77);
    expect(decoded?.userId).toBe(1);
    expect(decoded?.username).toBe("admin");

    expect(verifyMediaTicket(ticket, 99)).toBe(false);
    expect(decodeMediaTicket(ticket, 99)).toBeNull();
  });

  it("[TX-05] updates JWT token lifetimes dynamically via setSecurityTokenLifetimes", async () => {
    setSecurityTokenLifetimes({ jwtAccessExpiryMin: 30, jwtRefreshExpiryDays: 14 });
    const lifetimes = await getSecurityTokenLifetimes();
    expect(lifetimes.accessExpiresSec).toBe(1800);
    expect(lifetimes.refreshExpiresSec).toBe(14 * 86400);
  });

  it("[PB-01 / PB-03 / U-04] validates safe storage paths asynchronously with LRU caching", async () => {
    const rawDir = path.resolve(process.env.RAW_DIR || "data/raw");
    await fs.mkdir(rawDir, { recursive: true });
    const safeFile = path.join(rawDir, `audit_safe_${Date.now()}.mp4`);
    await fs.writeFile(safeFile, "test");

    try {
      expect(await isPathSafeAsync(safeFile)).toBe(true);
      // Second call hits LRU cache
      expect(await isPathSafeAsync(safeFile)).toBe(true);

      const outsideFile = path.join(os.tmpdir(), "outside_unsafe.mp4");
      expect(await isPathSafeAsync(outsideFile)).toBe(false);
    } finally {
      await fs.unlink(safeFile).catch(() => {});
    }
  });

  it("[TX-04] computes duration-weighted VMAF mean across chunks", () => {
    const chunks = [
      { durationSec: 900, vmafMean: 90 },
      { durationSec: 100, vmafMean: 80 },
    ];
    // (900*90 + 100*80) / 1000 = 89.0 (unweighted would be 85.0)
    expect(calculateWeightedVmafMean(chunks)).toBe(89);
  });

  it("[TX-03 / Top-15 TX-02] honors system_config preferredEncoder unless camera explicitly overrides", () => {
    expect(resolveSelectedEncoder(null, "av1_nvenc")).toBe("av1_nvenc");
    expect(resolveSelectedEncoder(undefined, "libsvtav1")).toBe("libsvtav1");
    expect(resolveSelectedEncoder("av1_nvenc", "hevc_nvenc")).toBe("hevc_nvenc");
    expect(resolveSelectedEncoder("libx265", "hevc_nvenc")).toBe("libx265");
  });

  it("[AI-03 / TX-01 / P-05] rejects PROBE_SAMPLE_SEC exceeding ACTIVITY_WINDOW_SEC", async () => {
    const fakePool = {} as any;
    await expect(
      processRecordingTranscode(1, {
        pool: fakePool,
        activityWindowSec: 10,
        probeSampleSec: 20,
      })
    ).rejects.toThrow("PROBE_SAMPLE_SEC cannot exceed ACTIVITY_WINDOW_SEC");
  });

  it("[ING-04 / SEC-02] encrypts and decrypts Redis RTSP envelope without leaking plaintext", () => {
    const key = deriveCredentialKey(Buffer.from("01234567890123456789012345678901").toString("base64"));
    const rtsp = "rtsp://admin:SuperSecret!@10.0.0.50:554/Streaming/Channels/101";
    const redisVal = encryptRtspUrlForRedis(rtsp, key);

    expect(redisVal.startsWith("enc:v1:")).toBe(true);
    expect(redisVal).not.toContain("SuperSecret!");
    expect(decryptRtspUrlFromRedis(redisVal, key)).toBe(rtsp);
  });
});
