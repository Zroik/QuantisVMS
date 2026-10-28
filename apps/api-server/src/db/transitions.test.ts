import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDbPool, closeDbPool } from "./connection.js";
import {
  transitionRecordingStatus,
  IllegalStatusTransitionError,
} from "./transitions.js";

describe("Gate G4.3: Status Transition State Machine (Spec §7, Gate G4.3)", () => {
  const pool = getDbPool();
  let testCamId: number;
  let testRecId: number;

  beforeAll(async () => {
    // Seed camera
    const [camRes] = await pool.query<any>(
      `INSERT INTO cameras (name, rtsp_url_enc, rtsp_host, enabled, active_yolo_classes)
       VALUES ('Transitions Test Cam', 0x1234, '127.0.0.1:554', 1, '[]')`
    );
    testCamId = camRes.insertId;

    // Seed recording starting at RECORDING
    const [recRes] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status)
       VALUES (?, NOW(3), 'data/raw/transition_test.mp4', 'RECORDING')`,
      [testCamId]
    );
    testRecId = recRes.insertId;
  });

  afterAll(async () => {
    if (testRecId) {
      await pool.query("DELETE FROM recordings WHERE id = ?", [testRecId]);
    }
    if (testCamId) {
      await pool.query("DELETE FROM cameras WHERE id = ?", [testCamId]);
    }
    await closeDbPool();
  });

  it("item 1: enforces legal status sequence RECORDING -> RAW -> QUEUED -> PROBING -> ENCODING -> VERIFYING -> COMPLETED", async () => {
    // 1. RECORDING -> RAW
    const t1 = await transitionRecordingStatus(pool, testRecId, "RAW", {
      duration_sec: 60,
      width: 1920,
      height: 1080,
    });
    expect(t1.previousStatus).toBe("RECORDING");
    expect(t1.currentStatus).toBe("RAW");

    // 2. RAW -> QUEUED
    const t2 = await transitionRecordingStatus(pool, testRecId, "QUEUED");
    expect(t2.previousStatus).toBe("RAW");
    expect(t2.currentStatus).toBe("QUEUED");

    // 3. QUEUED -> PROBING
    const t3 = await transitionRecordingStatus(pool, testRecId, "PROBING");
    expect(t3.previousStatus).toBe("QUEUED");
    expect(t3.currentStatus).toBe("PROBING");

    // 4. PROBING -> ENCODING
    const t4 = await transitionRecordingStatus(pool, testRecId, "ENCODING", { optimal_cq: 26 });
    expect(t4.previousStatus).toBe("PROBING");
    expect(t4.currentStatus).toBe("ENCODING");

    // 5. ENCODING -> VERIFYING
    const t5 = await transitionRecordingStatus(pool, testRecId, "VERIFYING", {
      compressed_path: "data/compressed/cam1/transition_test.mp4",
    });
    expect(t5.previousStatus).toBe("ENCODING");
    expect(t5.currentStatus).toBe("VERIFYING");

    // 6. VERIFYING -> COMPLETED
    const t6 = await transitionRecordingStatus(pool, testRecId, "COMPLETED", {
      quality_gate_met: 1,
      vmaf_mean: 92.4,
      vmaf_p25: 89.1,
    });
    expect(t6.previousStatus).toBe("VERIFYING");
    expect(t6.currentStatus).toBe("COMPLETED");

    // Check DB row reflects updates
    const [rows] = await pool.query<any[]>("SELECT * FROM recordings WHERE id = ?", [testRecId]);
    expect(rows[0].status).toBe("COMPLETED");
    expect(rows[0].quality_gate_met).toBe(1);
    expect(rows[0].optimal_cq).toBe("26.0");
  });

  it("item 2: rejects illegal status transitions with IllegalStatusTransitionError", async () => {
    // Current status is COMPLETED (terminal). Cannot move to PROBING or RAW
    await expect(
      transitionRecordingStatus(pool, testRecId, "PROBING")
    ).rejects.toThrow(IllegalStatusTransitionError);

    await expect(
      transitionRecordingStatus(pool, testRecId, "RAW")
    ).rejects.toThrow(IllegalStatusTransitionError);

    // Create a new recording at RECORDING
    const [rec2Res] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status)
       VALUES (?, NOW(3), 'data/raw/transition_test2.mp4', 'RECORDING')`,
      [testCamId]
    );
    const rec2Id = rec2Res.insertId;

    // Cannot jump from RECORDING to ENCODING or COMPLETED
    await expect(
      transitionRecordingStatus(pool, rec2Id, "ENCODING")
    ).rejects.toThrow(IllegalStatusTransitionError);

    await expect(
      transitionRecordingStatus(pool, rec2Id, "COMPLETED")
    ).rejects.toThrow(IllegalStatusTransitionError);

    // Clean up
    await pool.query("DELETE FROM recordings WHERE id = ?", [rec2Id]);
  });

  it("item 3: supports VERIFYING -> SKIPPED branch", async () => {
    const [rec3Res] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status)
       VALUES (?, NOW(3), 'data/raw/transition_test3.mp4', 'RAW')`,
      [testCamId]
    );
    const rec3Id = rec3Res.insertId;

    await transitionRecordingStatus(pool, rec3Id, "QUEUED");
    await transitionRecordingStatus(pool, rec3Id, "PROBING");
    await transitionRecordingStatus(pool, rec3Id, "ENCODING");
    await transitionRecordingStatus(pool, rec3Id, "VERIFYING");

    // No space gain: VERIFYING -> SKIPPED
    const tSkip = await transitionRecordingStatus(pool, rec3Id, "SKIPPED", {
      failure_reason: "Compressed size >= raw size",
    });
    expect(tSkip.currentStatus).toBe("SKIPPED");

    await pool.query("DELETE FROM recordings WHERE id = ?", [rec3Id]);
  });

  it("item 4: supports any step -> FAILED, and FAILED -> QUEUED (requeue)", async () => {
    const [rec4Res] = await pool.query<any>(
      `INSERT INTO recordings (camera_id, started_at, raw_path, status)
       VALUES (?, NOW(3), 'data/raw/transition_test4.mp4', 'PROBING')`,
      [testCamId]
    );
    const rec4Id = rec4Res.insertId;

    // Fail during probing
    const tFail = await transitionRecordingStatus(pool, rec4Id, "FAILED", {
      failure_reason: "CUDA device out of memory",
    });
    expect(tFail.currentStatus).toBe("FAILED");

    // Requeue failed job
    const tRequeue = await transitionRecordingStatus(pool, rec4Id, "QUEUED", {
      attempts: 0,
    });
    expect(tRequeue.currentStatus).toBe("QUEUED");

    await pool.query("DELETE FROM recordings WHERE id = ?", [rec4Id]);
  });
});

