import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fsp from "node:fs/promises";
import mysql, { type Pool } from "mysql2/promise";
import dotenv from "dotenv";
import { RecorderService } from "./recorder.js";
import { FFmpegSupervisor } from "./supervisor.js";
import { probeVideo } from "./probe.js";
import { reconcileOrphanRecordings } from "./reconciler.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../../.env") });

describe("Gates G3.6 & G3.7: Recorder Service, Supervision, and Mid-file Recovery", () => {
  let pool: Pool;
  let testCamId: number;
  const testOutputDir = path.resolve("data/raw/cam999");

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || "vms_user",
      password: process.env.MYSQL_PASSWORD || "vms_password_secret",
      database: process.env.MYSQL_DATABASE || "vms_db",
      waitForConnections: true,
      connectionLimit: 5,
    });

    await fsp.mkdir(testOutputDir, { recursive: true });

    // Seed test camera
    const [camRes] = await pool.query<any>(
      `INSERT INTO cameras (name, rtsp_url_enc, rtsp_host, enabled, active_yolo_classes)
       VALUES ('Recorder Gate Test Cam', 0x1234, '127.0.0.1:554', 1, '[]')`
    );
    testCamId = camRes.insertId;
  });

  afterAll(async () => {
    try {
      await fsp.rm(testOutputDir, { recursive: true, force: true });
    } catch {}
    if (pool) {
      await pool.query("DELETE FROM recordings WHERE camera_id = ?", [testCamId]);
      await pool.query("DELETE FROM cameras WHERE id = ?", [testCamId]);
      await pool.end();
    }
  });

  it("G3.6: segments created, rows RECORDING -> RAW, duration within ±2s of ffprobe", async () => {
    // Test stream: live camera if available, or lavfi source
    const rtspUrl = process.env.LIVE_RTSP_URL || "rtsp://admin:SecretPassword123%40@192.168.1.100:554/Streaming/Channels/101";

    const recorder = new RecorderService({
      pool,
      rawDir: path.resolve("data/raw"),
      segmentSec: 3, // Fast profile 3s segment
    });

    await recorder.start();

    // Register camera with supervisor
    const supervisor = await recorder.registerCamera(testCamId, rtspUrl);
    expect(supervisor).toBeDefined();

    // Wait up to 10s for segment file to appear and register
    let recordedRow: any = null;
    const deadline = Date.now() + 10000;

    while (Date.now() < deadline) {
      const [rows] = await pool.query<any[]>(
        "SELECT * FROM recordings WHERE camera_id = ? ORDER BY id DESC LIMIT 1",
        [testCamId]
      );
      if (rows.length > 0) {
        recordedRow = rows[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(recordedRow).toBeDefined();
    expect(["RECORDING", "RAW"]).toContain(recordedRow.status);

    // Allow segment to record media frames (segmentSec = 3)
    await new Promise((r) => setTimeout(r, 3500));

    // Stop recorder, triggering finalization of the active segment
    await recorder.stop();

    // Verify row transitioned to RAW and probed duration matches ffprobe ±2s
    const [finalRows] = await pool.query<any[]>(
      "SELECT * FROM recordings WHERE id = ?",
      [recordedRow.id]
    );
    expect(finalRows.length).toBe(1);
    const finalized = finalRows[0];
    expect(finalized.status).toBe("RAW");
    expect(finalized.duration_sec).toBeGreaterThan(0);

    // Independent ffprobe verification
    const probe = await probeVideo(finalized.raw_path);
    const diff = Math.abs(finalized.duration_sec - probe.durationSec);
    expect(diff).toBeLessThanOrEqual(2.0); // Within ±2 s of ffprobe
    expect(finalized.width).toBe(probe.width);
    expect(finalized.height).toBe(probe.height);
  }, 25000);

  it("G3.7: kill ffmpeg => restarts with backoff", async () => {
    const supervisor = new FFmpegSupervisor({
      cameraId: testCamId,
      rtspUrl: process.env.LIVE_RTSP_URL || "rtsp://admin:SecretPassword123%40@192.168.1.100:554/Streaming/Channels/101",
      outputDir: testOutputDir,
      segmentSec: 5,
    });

    await supervisor.start();

    // Wait for process to spawn
    let proc = supervisor.getChildProcess();
    const spawnDeadline = Date.now() + 5000;
    while (!proc && Date.now() < spawnDeadline) {
      await new Promise((r) => setTimeout(r, 100));
      proc = supervisor.getChildProcess();
    }
    expect(proc).toBeDefined();
    const firstPid = proc?.pid;
    expect(firstPid).toBeDefined();
    expect(supervisor.getBackoffSec()).toBe(1);

    // Kill ffmpeg abruptly
    proc?.kill("SIGKILL");

    // Wait for supervisor to handle exit and advance backoff
    await new Promise((r) => setTimeout(r, 600));

    // Backoff doubled (1s -> 2s)
    expect(supervisor.getBackoffSec()).toBe(2);
    expect(supervisor.getConsecutiveFailures()).toBe(1);

    // Wait for restart delay (1s) and check new process spawned
    await new Promise((r) => setTimeout(r, 1500));
    const newProc = supervisor.getChildProcess();
    expect(newProc).toBeDefined();
    expect(newProc?.pid).not.toBe(firstPid);

    await supervisor.stop();
  }, 15000);

  it("G3.7: kill recorder mid-file => file finalized as RAW after restart", async () => {
    // 1. Simulate mid-file crash: use existing valid mp4 chunk in tests or data
    const crashFilePath = path.join(testOutputDir, "20261028_120000.mp4");
    const sourceVideoPath = path.resolve(__dirname, "../../../../tests/1minuteroad.mp4");
    await fsp.copyFile(sourceVideoPath, crashFilePath);

    // Insert an abandoned recording with status 'RECORDING'
    const [crashRes] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status)
       VALUES (?, '2026-10-28 12:00:00', ?, 'RECORDING')`,
      [testCamId, crashFilePath]
    );
    const crashedRecordingId = crashRes.insertId;

    // 2. Run startup reconciliation (simulating recorder service restart)
    const result = await reconcileOrphanRecordings(pool);
    expect(result.recovered).toBeGreaterThanOrEqual(1);

    // 3. Verify DB row was finalized as RAW
    const [recoveredRows] = await pool.query<any[]>(
      "SELECT * FROM recordings WHERE id = ?",
      [crashedRecordingId]
    );
    expect(recoveredRows.length).toBe(1);
    const recoveredRec = recoveredRows[0];

    expect(recoveredRec.status).toBe("RAW");
    expect(recoveredRec.duration_sec).toBe(60);
    expect(recoveredRec.width).toBe(1920);
    expect(recoveredRec.height).toBe(1080);
    expect(recoveredRec.codec_raw).toBe("h264");
  });
});
