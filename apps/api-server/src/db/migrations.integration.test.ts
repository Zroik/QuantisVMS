import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql, { type Pool } from "mysql2/promise";
import { migrateUp, migrateDown } from "./migrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env"), override: true });
process.env.MYSQL_HOST = "127.0.0.1";
process.env.MYSQL_PORT = "3307";
const migrationsDir = path.join(__dirname, "migrations");

describe("Gate G3.1: Migrations Up/Down/Up on Live DB", () => {
  const TEST_DB = "vms_migration_test";
  let pool: Pool;

  beforeAll(async () => {
    const rootUser = process.env.MYSQL_ROOT_USER || "root";
    const rootPass = process.env.MYSQL_ROOT_PASSWORD || "vms_root_secret";
    const adminPool = mysql.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: rootUser,
      password: rootPass,
    });
    await adminPool.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\``);
    await adminPool.end();

    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: rootUser,
      password: rootPass,
      database: TEST_DB,
      multipleStatements: true,
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("performs clean migrateUp, verifies schema columns match Spec §7, migrates down, and migrates up cleanly", async () => {
    // 1. First ensure any previous test runs are cleanly rolled back or applied
    await migrateDown(pool, migrationsDir, 10);

    // 2. Initial migrateUp
    const appliedFirst = await migrateUp(pool, migrationsDir);
    expect(appliedFirst).toContain("001_initial_schema");
    expect(appliedFirst).toContain("002_camera_split");
    expect(appliedFirst).toContain("003_system_config");

    // 3. Inspect columns for each table vs Spec §7
    const expectedTables: Record<string, string[]> = {
      users: ["id", "username", "password_hash", "role", "created_at"],
      cameras: [
        "id", "name", "rtsp_url_enc", "rtsp_host", "enabled",
        "active_yolo_classes", "confidence_threshold", "target_vmaf", "target_vmaf_p25",
        "preferred_encoder", "smart_ai_sampling", "split_count", "slice_index", "parent_camera_id",
        "static_cq_cache", "static_cq_cached_at",
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
      system_config: [
        "config_key", "config_value", "updated_at"
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
    const rolledBack = await migrateDown(pool, migrationsDir, 10);
    expect(rolledBack).toContain("001_initial_schema");
    expect(rolledBack).toContain("002_camera_split");
    expect(rolledBack).toContain("003_system_config");

    // Verify tables are dropped
    const [remainingTables] = await pool.query<any[]>(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)",
      [Object.keys(expectedTables)]
    );
    expect(remainingTables.length).toBe(0);

    // 5. Re-run migrateUp
    const appliedSecond = await migrateUp(pool, migrationsDir);
    expect(appliedSecond).toContain("001_initial_schema");
    expect(appliedSecond).toContain("002_camera_split");
    expect(appliedSecond).toContain("003_system_config");

    // Verify all tables recreated
    const [finalTables] = await pool.query<any[]>(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)",
      [Object.keys(expectedTables)]
    );
    expect(finalTables.length).toBe(Object.keys(expectedTables).length);
  });
});

