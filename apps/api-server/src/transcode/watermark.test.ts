import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { getDbPool, closeDbPool } from "../db/connection.js";
import { evaluateDiskWatermark } from "./watermark.js";

describe("Gate G4.9: Disk Safety Watermark & Early Enqueuing (Spec §8.7, Gate G4.9)", () => {
  const pool = getDbPool();
  let testCamId: number;
  let rec1Id: number;
  let rec2Id: number;

  beforeAll(async () => {
    // Seed camera
    const [camRes] = await pool.query<any>(
      `INSERT INTO cameras (name, rtsp_url_enc, rtsp_host, enabled, active_yolo_classes)
       VALUES ('Watermark Test Cam', 0x1234, '127.0.0.1:554', 1, '[]')`
    );
    testCamId = camRes.insertId;

    // Seed 2 RAW recordings with different started_at
    const [r1] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, ended_at, raw_path, status)
       VALUES (?, '2026-10-27 10:00:00', '2026-10-27 10:01:00', 'data/raw/wm_test_old.mp4', 'RAW')`,
      [testCamId]
    );
    rec1Id = r1.insertId;

    const [r2] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, ended_at, raw_path, status)
       VALUES (?, '2026-10-28 10:00:00', '2026-10-28 10:01:00', 'data/raw/wm_test_new.mp4', 'RAW')`,
      [testCamId]
    );
    rec2Id = r2.insertId;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM recordings WHERE camera_id = ?", [testCamId]);
    await pool.query("DELETE FROM cameras WHERE id = ?", [testCamId]);
    await closeDbPool();
  });

  it("item 1: normal disk usage (< highWatermark) does not trigger enqueuing or alerts", async () => {
    const res = await evaluateDiskWatermark(70.0, pool, null, null, {
      highWatermarkPct: 85,
      criticalWatermarkPct: 95,
    });

    expect(res.level).toBe("normal");
    expect(res.enqueuedCount).toBe(0);
    expect(res.alertEmitted).toBe(false);

    // Verify status remained RAW
    const [rows] = await pool.query<any[]>("SELECT status FROM recordings WHERE id = ?", [rec1Id]);
    expect(rows[0].status).toBe("RAW");
  });

  it("item 2: high disk usage (>= highWatermark) triggers early enqueuing oldest first and emits alert", async () => {
    const publishedAlerts: any[] = [];
    const mockRedis = {
      publish: vi.fn().mockImplementation((channel, msg) => {
        publishedAlerts.push(JSON.parse(msg));
        return Promise.resolve(1);
      }),
    } as any;

    const enqueuedJobs: any[] = [];
    const mockQueue = {
      add: vi.fn().mockImplementation((name, data) => {
        enqueuedJobs.push(data);
        return Promise.resolve({ id: `rec-${data.recordingId}` });
      }),
    } as any;

    const res = await evaluateDiskWatermark(88.0, pool, mockQueue, mockRedis, {
      highWatermarkPct: 85,
      criticalWatermarkPct: 95,
    });

    expect(res.level).toBe("high");
    expect(res.enqueuedCount).toBeGreaterThanOrEqual(2);
    expect(res.alertEmitted).toBe(true);

    // Assert the two seeded recordings were enqueued oldest-first. Other RAW
    // rows from concurrent tests may also be eligible, so compare their relative order.
    const enqueuedIds = enqueuedJobs.map((j) => j.recordingId);
    const i1 = enqueuedIds.indexOf(rec1Id);
    const i2 = enqueuedIds.indexOf(rec2Id);
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);

    // Assert status updated to QUEUED in DB
    const [rows] = await pool.query<any[]>(
      "SELECT id, status FROM recordings WHERE id IN (?, ?)",
      [rec1Id, rec2Id]
    );
    expect(rows.every((r) => r.status === "QUEUED")).toBe(true);

    // Assert alert payload
    expect(publishedAlerts[0].type).toBe("disk_watermark");
    expect(publishedAlerts[0].level).toBe("warning");

    // Critical invariant: nothing unverified is ever deleted
    const [finalRows] = await pool.query<any[]>(
      "SELECT COUNT(*) as count FROM recordings WHERE id IN (?, ?)",
      [rec1Id, rec2Id]
    );
    expect(finalRows[0].count).toBe(2);
  });
});

