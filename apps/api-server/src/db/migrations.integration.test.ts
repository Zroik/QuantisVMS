import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDbPool, closeDbPool } from "./connection.js";
import { migrateUp, migrateDown } from "./migrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

describe("Gate G3.1: Migrations Up/Down/Up on Live DB", () => {
  const pool = getDbPool();

  afterAll(async () => {
    await closeDbPool();
  });

  it("performs clean migrateUp, verifies schema columns match Spec §7, migrates down, and migrates up cleanly", async () => {
    // 1. First ensure any previous test runs are cleanly rolled back or applied
    await migrateDown(pool, migrationsDir, 1);

    // 2. Initial migrateUp
    const appliedFirst = await migrateUp(pool, migrationsDir);
    expect(appliedFirst).toContain("001_initial_schema");

    // 3. Inspect columns for each table vs Spec §7
    const expectedTables: Record<string, string[]> = {
      users: ["id", "username", "password_hash", "role", "created_at"],
      cameras: [
        "id", "name", "rtsp_url_enc", "rtsp_host", "enabled",
        "active_yolo_classes", "confidence_threshold", "target_vmaf", "target_vmaf_p25",
        "preferred_encoder", "smart_ai_sampling", "static_cq_cache", "static_cq_cached_at",
        "created_at", "updated_at"
      ],
      recordings: [
        "id", "camera_id", "started_at", "ended_at", "duration_sec",
        "raw_path", "compressed_path", "raw_size_bytes", "compressed_size_bytes",
        "width", "height", "fps", "codec_raw", "optimal_cq",
        "vmaf_mean", "vmaf_p25", "quality_gate_met", "status",
        "failure_reason", "attempts", "verified_at", "raw_deleted_at",
        "created_at", "updated_at"
      ],
      recording_chunks: [
        "id", "recording_id", "chunk_index", "start_offset_sec", "duration_sec",
        "sampling_mode", "sample_start_sec", "optimal_cq", "gate_met",
        "vmaf_mean", "vmaf_p25", "compressed_path", "status"
      ],
      recording_activity_windows: [
        "id", "recording_id", "segment_index", "window_index", "start_offset_sec",
        "person_count", "vehicle_count", "pet_count", "other_count",
        "frames_processed", "weighted_activity_score"
      ],
      vmaf_probe_logs: [
        "id", "recording_id", "chunk_id", "iteration_num", "tested_cq",
        "sample_vmaf_mean", "sample_vmaf_p25", "sample_vmaf_hmean", "sample_vmaf_min",
        "backend", "frames_scored", "duration_ms", "created_at"
      ],
      ai_detection_events: [
        "id", "camera_id", "recording_id", "class_id", "class_name",
        "confidence", "bbox_json", "snapshot_path", "detected_at"
      ],
    };

    for (const [tableName, expectedCols] of Object.entries(expectedTables)) {
      const [columns] = await pool.query<any[]>(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
        [tableName]
      );
      const actualCols = columns.map((c) => c.COLUMN_NAME);
      expect(actualCols.length).toBeGreaterThan(0);

      // Verify each required column exists
      for (const col of expectedCols) {
        expect(actualCols, `Table ${tableName} missing column ${col}`).toContain(col);
      }
    }

    // 4. Migrate down
    const rolledBack = await migrateDown(pool, migrationsDir, 1);
    expect(rolledBack).toContain("001_initial_schema");

    // Verify tables are dropped
    const [remainingTables] = await pool.query<any[]>(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)",
      [Object.keys(expectedTables)]
    );
    expect(remainingTables.length).toBe(0);

    // 5. Re-run migrateUp
    const appliedSecond = await migrateUp(pool, migrationsDir);
    expect(appliedSecond).toContain("001_initial_schema");

    // Verify all tables recreated
    const [finalTables] = await pool.query<any[]>(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)",
      [Object.keys(expectedTables)]
    );
    expect(finalTables.length).toBe(Object.keys(expectedTables).length);
  });
});

