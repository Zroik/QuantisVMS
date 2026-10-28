import { describe, it, expect } from "vitest";
import { splitSqlStatements, loadMigrationFiles } from "./migrator.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Database Migrator (Spec §7, Gate G3.1)", () => {
  it("loads up and down migration files in sorted order", async () => {
    const migrationsDir = path.join(__dirname, "migrations");
    const migrations = await loadMigrationFiles(migrationsDir);

    expect(migrations.length).toBeGreaterThan(0);
    const initial = migrations.find((m) => m.version === "001_initial_schema");
    expect(initial).toBeDefined();
    expect(initial?.upSql).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(initial?.upSql).toContain("CREATE TABLE IF NOT EXISTS cameras");
    expect(initial?.upSql).toContain("CREATE TABLE IF NOT EXISTS recordings");
    expect(initial?.upSql).toContain("CREATE TABLE IF NOT EXISTS recording_chunks");
    expect(initial?.upSql).toContain("CREATE TABLE IF NOT EXISTS recording_activity_windows");
    expect(initial?.upSql).toContain("CREATE TABLE IF NOT EXISTS vmaf_probe_logs");
    expect(initial?.upSql).toContain("CREATE TABLE IF NOT EXISTS ai_detection_events");

    expect(initial?.downSql).toContain("DROP TABLE IF EXISTS ai_detection_events");
    expect(initial?.downSql).toContain("DROP TABLE IF EXISTS users");
  });

  it("splits SQL statements correctly by semicolon ignoring comments", () => {
    const sql = `
      -- First table
      CREATE TABLE test1 (id INT PRIMARY KEY);
      /* Second table */
      CREATE TABLE test2 (name VARCHAR(50));
    `;
    const stmts = splitSqlStatements(sql);
    expect(stmts.length).toBe(2);
    expect(stmts[0]).toContain("CREATE TABLE test1");
    expect(stmts[1]).toContain("CREATE TABLE test2");
  });
});
