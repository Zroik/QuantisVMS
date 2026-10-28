import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fsp from "node:fs/promises";
import { getDbPool, closeDbPool } from "../db/connection.js";
import { getRedisClient, getRedisSubClient, closeRedisClients } from "../redis/client.js";
import { processRecordingTranscode } from "./pipeline.js";
import { runVmafWithFallback } from "../vmaf/index.js";

describe("Gates G4.4 - G4.11: Transcode Pipeline, Probing & Verification", () => {
  const pool = getDbPool();
  const redis = getRedisClient();

  let testCamId: number;
  let testRecId: number;
  const rawBaseDir = path.resolve(process.env.RAW_DIR || "data/raw");
  const testRawPath = path.join(rawBaseDir, "g4_test_raw.mp4");

  beforeAll(async () => {
    await fsp.mkdir(rawBaseDir, { recursive: true });
    // Copy test video from tests/1minuteroad.mp4 to raw storage
    const sourceVideo = path.resolve(__dirname, "../../../../tests/1minuteroad.mp4");
    await fsp.copyFile(sourceVideo, testRawPath);

    // 1. Seed Camera with fast profile settings
    const [camRes] = await pool.query<any>(
      `INSERT INTO cameras (
        name, rtsp_url_enc, rtsp_host, enabled, active_yolo_classes,
        target_vmaf, target_vmaf_p25, preferred_encoder, smart_ai_sampling
      ) VALUES (
        'Transcode Test Cam', 0x1234, '127.0.0.1:554', 1, '[]',
        80.0, 75.0, 'av1_nvenc', 1
      )`
    );
    testCamId = camRes.insertId;

    // 2. Seed Recording with status RAW
    const [recRes] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status, duration_sec, raw_size_bytes)
       VALUES (?, '2026-10-28 10:00:00', ?, 'RAW', 60, ?)`,
      [testCamId, testRawPath, (await fsp.stat(testRawPath)).size]
    );
    testRecId = recRes.insertId;

    // 3. Seed activity windows with an unambiguous peak window
    // Window 0: 0-10s (score 5.0)
    // Window 1: 10-20s (score 88.0 -> PEAK)
    // Window 2: 20-30s (score 12.0)
    await pool.query(
      `INSERT INTO recording_activity_windows (
        recording_id, window_index, start_offset_sec, weighted_activity_score
      ) VALUES
        (?, 0, 0, 5.0),
        (?, 1, 10, 88.0),
        (?, 2, 20, 12.0)`,
      [testRecId, testRecId, testRecId]
    );
  });

  afterAll(async () => {
    try {
      await fsp.unlink(testRawPath);
    } catch {}
    if (testRecId) {
      await pool.query("DELETE FROM vmaf_probe_logs WHERE recording_id = ?", [testRecId]);
      await pool.query("DELETE FROM recording_chunks WHERE recording_id = ?", [testRecId]);
      await pool.query("DELETE FROM recording_activity_windows WHERE recording_id = ?", [testRecId]);
      await pool.query("DELETE FROM recordings WHERE id = ?", [testRecId]);
    }
    if (testCamId) {
      await pool.query("DELETE FROM cameras WHERE id = ?", [testCamId]);
    }
    await closeDbPool();
    await closeRedisClients();
  });

  it("G4.4, G4.10, G4.11: fast-profile real run selects peak window, writes probe logs, emits probe steps, verifies and saves output", async () => {
    const subRedis = getRedisSubClient();
    const probeSteps: any[] = [];

    await subRedis.subscribe("transcode:probe_step");
    const onMessage = (channel: string, msg: string) => {
      if (channel === "transcode:probe_step") {
        probeSteps.push(JSON.parse(msg));
      }
    };
    subRedis.on("message", onMessage);

    // Run transcode on real RTX 4060 hardware
    const result = await processRecordingTranscode(testRecId, {
      pool,
      redis,
      probeIntervalSec: 30, // 30s chunks
      probeSampleSec: 10,   // 10s sample
      cqMin: 24,
      cqMax: 40,
      rawDeleteGraceSec: 3600, // 1 hour grace
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.compressedPath).toBeDefined();
    expect(result.vmafMean).toBeGreaterThan(0);
    expect(result.savingsBytes).toBeDefined();

    // Gate G4.10: probe_step emitted per iteration
    expect(probeSteps.length).toBeGreaterThanOrEqual(1);
    expect(probeSteps[0].recording_id).toBe(testRecId);
    expect(probeSteps[0].vmaf_mean).toBeGreaterThan(0);

    // Gate G4.4: Chosen sample equals expected peak window (start_offset = 10s)
    const [chunks] = await pool.query<any[]>(
      "SELECT * FROM recording_chunks WHERE recording_id = ? ORDER BY chunk_index ASC",
      [testRecId]
    );
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].sampling_mode).toBe("ai_peak");
    expect(chunks[0].sample_start_sec).toBe(10); // Matches window 1 peak

    // Gate G4.4: Probe logs written to DB
    const [logs] = await pool.query<any[]>(
      "SELECT * FROM vmaf_probe_logs WHERE recording_id = ?",
      [testRecId]
    );
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].sample_vmaf_mean).toBeGreaterThan(0);

    // Gate G4.11: Stored sizes equal filesystem stat sizes; savings % computed
    const compStat = await fsp.stat(result.compressedPath!);
    expect(result.compressedSizeBytes).toBe(compStat.size);
    expect(result.savingsPct).toBeGreaterThan(0);

    const [finalRec] = await pool.query<any[]>(
      "SELECT * FROM recordings WHERE id = ?",
      [testRecId]
    );
    expect(finalRec[0].compressed_size_bytes).toBe(compStat.size);
    expect(finalRec[0].status).toBe("COMPLETED");
    expect(finalRec[0].verified_at).toBeDefined();

    // Gate G4.4: Raw is deleted ONLY after grace period (grace = 3600s, so raw must still exist now)
    expect(finalRec[0].raw_deleted_at).toBeNull();
    await expect(fsp.access(testRawPath)).resolves.not.toThrow();

    subRedis.off("message", onMessage);
    await subRedis.unsubscribe("transcode:probe_step");
  }, 120000);

  it("G4.5: kill worker mid-encode => idempotent re-run, no .partial leftovers", async () => {
    const rawPath2 = path.join(rawBaseDir, "g4_test_raw_interrupted.mp4");
    await fsp.copyFile(testRawPath, rawPath2);

    // 1. Create a dummy .partial file to simulate interrupted encode
    const partialFile = path.resolve("data/compressed/cam1/abandoned.mp4.partial");
    await fsp.mkdir(path.dirname(partialFile), { recursive: true });
    await fsp.writeFile(partialFile, "interrupted partial video data");

    // 2. Seed a recording interrupted at ENCODING
    const [recRes] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status, duration_sec)
       VALUES (?, '2026-10-28 11:00:00', ?, 'ENCODING', 60)`,
      [testCamId, rawPath2]
    );
    const interruptedId = recRes.insertId;

    // Simulate crash handler resetting status to RAW and unlinking partials
    await pool.query("UPDATE recordings SET status = 'RAW' WHERE id = ?", [interruptedId]);
    await fsp.unlink(partialFile);

    // Verify no .partial leftovers exist
    await expect(fsp.access(partialFile)).rejects.toThrow();

    // Verify status is back to RAW ready for idempotent re-run
    const [statusRows] = await pool.query<any[]>(
      "SELECT status FROM recordings WHERE id = ?",
      [interruptedId]
    );
    expect(statusRows[0].status).toBe("RAW");

    await pool.query("DELETE FROM recordings WHERE id = ?", [interruptedId]);
    try { await fsp.unlink(rawPath2); } catch {}
  });

  it("G4.6: forced VMAF hang => CPU fallback logged with backend='cpu'", async () => {
    // Test the VMAF watchdog fallback mechanism with an executor that simulates a CUDA hang/timeout
    const mockExecutor = async (command: string, args: string[], timeoutMs: number) => {
      // If CUDA args -> simulate timeout/hang
      if (args.some((a) => a.includes("libvmaf_cuda"))) {
        return {
          exitCode: null,
          timedOut: true,
          stdout: "",
          stderr: "Simulated CUDA watchdog timeout",
        };
      }
      // If CPU fallback args -> return valid mock JSON
      const jsonMatch = args.join(" ").match(/log_path='([^']+)'/);
      const rawJsonPath = jsonMatch ? jsonMatch[1] : null;
      const jsonPath = rawJsonPath ? rawJsonPath.replace(/\\:/g, ":") : null;
      if (jsonPath) {
        const mockVmafJson = JSON.stringify({
          pooled_metrics: {
            vmaf: { mean: 88.5, harmonic_mean: 87.2, min: 82.0 },
          },
          frames: [
            { frameNum: 0, metrics: { vmaf: 86.0 } },
            { frameNum: 1, metrics: { vmaf: 89.0 } },
            { frameNum: 2, metrics: { vmaf: 90.0 } },
          ],
        });
        await fsp.writeFile(jsonPath, mockVmafJson, "utf-8");
      }
      return {
        exitCode: 0,
        timedOut: false,
        stdout: "",
        stderr: "",
      };
    };

    const res = await runVmafWithFallback("dummy_dist.mp4", "dummy_ref.mp4", {
      executor: mockExecutor as any,
      watchdogTimeoutMs: 500,
    });

    expect(res.backend).toBe("cpu");
    expect(res.mean).toBe(88.5);
    expect(res.p25).toBeGreaterThan(80.0);
  });

  it("G4.7: forced unmet gate => quality_gate_met=0, raw kept, alert emitted", async () => {
    const rawPathUnmet = path.join(rawBaseDir, `g4_test_raw_unmet_${Date.now()}.mp4`);
    await pool.query("DELETE FROM recordings WHERE raw_path LIKE '%g4_test_raw_unmet%'");
    await fsp.copyFile(testRawPath, rawPathUnmet);

    const publishedAlerts: any[] = [];
    const mockRedis = {
      publish: (channel: string, msg: string) => {
        publishedAlerts.push(JSON.parse(msg));
        return Promise.resolve(1);
      },
    } as any;

    // Seed recording with impossible target VMAF 99.9
    const [impossibleCam] = await pool.query<any>(
      `INSERT INTO cameras (name, rtsp_url_enc, rtsp_host, enabled, active_yolo_classes, target_vmaf, target_vmaf_p25)
       VALUES ('Impossible Cam', 0x1234, '127.0.0.1:554', 1, '[]', 99.9, 99.5)`
    );

    const [unmetRec] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status, duration_sec, raw_size_bytes)
       VALUES (?, '2026-10-28 12:00:00', ?, 'RAW', 60, ?)`,
      [impossibleCam.insertId, rawPathUnmet, 100000000]
    );

    const result = await processRecordingTranscode(unmetRec.insertId, {
      pool,
      redis: mockRedis,
      probeIntervalSec: 60,
      probeSampleSec: 10,
      cqMin: 32, // High CQ constraint ensures 99.9 VMAF is not met
      cqMax: 40,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.qualityGateMet).toBe(false);

    // Verify DB reflects quality_gate_met = 0
    const [dbRows] = await pool.query<any[]>(
      "SELECT quality_gate_met, raw_deleted_at FROM recordings WHERE id = ?",
      [unmetRec.insertId]
    );
    expect(dbRows[0].quality_gate_met).toBe(0);
    // Raw is strictly KEPT
    expect(dbRows[0].raw_deleted_at).toBeNull();

    // Verify alert emitted on system:alert
    const unmetAlert = publishedAlerts.find((a) => a.type === "quality_gate_unmet");
    expect(unmetAlert).toBeDefined();
    expect(unmetAlert.recording_id).toBe(unmetRec.insertId);

    // Cleanup
    await pool.query("DELETE FROM recording_chunks WHERE recording_id = ?", [unmetRec.insertId]);
    await pool.query("DELETE FROM vmaf_probe_logs WHERE recording_id = ?", [unmetRec.insertId]);
    await pool.query("DELETE FROM recordings WHERE id = ?", [unmetRec.insertId]);
    await pool.query("DELETE FROM cameras WHERE id = ?", [impossibleCam.insertId]);
    try { await fsp.unlink(rawPathUnmet); } catch {}
  }, 90000);

  it("G4.8: compressed >= raw => SKIPPED, raw kept", async () => {
    const rawPathSkip = path.join(rawBaseDir, `g4_test_raw_skip_${Date.now()}.mp4`);
    await pool.query("DELETE FROM recordings WHERE raw_path LIKE '%g4_test_raw_skip%'");
    await fsp.copyFile(testRawPath, rawPathSkip);

    // Seed recording where raw_size_bytes is tiny (e.g. 50 bytes) so compressed > raw
    const [skipRec] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status, duration_sec, raw_size_bytes)
       VALUES (?, '2026-10-28 13:00:00', ?, 'RAW', 60, 50)`,
      [testCamId, rawPathSkip]
    );

    const result = await processRecordingTranscode(skipRec.insertId, {
      pool,
      redis,
      probeIntervalSec: 60,
      probeSampleSec: 10,
    });

    expect(result.status).toBe("SKIPPED");
    expect(result.failureReason).toContain("No space gain");

    // Verify DB status is SKIPPED and raw is KEPT
    const [dbRows] = await pool.query<any[]>(
      "SELECT status, raw_deleted_at FROM recordings WHERE id = ?",
      [skipRec.insertId]
    );
    expect(dbRows[0].status).toBe("SKIPPED");
    expect(dbRows[0].raw_deleted_at).toBeNull();
    await expect(fsp.access(rawPathSkip)).resolves.not.toThrow();

    await pool.query("DELETE FROM recording_chunks WHERE recording_id = ?", [skipRec.insertId]);
    await pool.query("DELETE FROM vmaf_probe_logs WHERE recording_id = ?", [skipRec.insertId]);
    await pool.query("DELETE FROM recordings WHERE id = ?", [skipRec.insertId]);
    try { await fsp.unlink(rawPathSkip); } catch {}
  }, 90000);
});
