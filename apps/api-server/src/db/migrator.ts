/**
 * MySQL Versioned Migration Runner (Spec §7, Gate G3.1).
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolConnection } from "mysql2/promise";

export interface MigrationFile {
  version: string;
  upPath: string;
  downPath: string;
  upSql: string;
  downSql: string;
}

/**
 * Splits multiple SQL statements delimited by semicolon, ignoring comments and whitespace.
 */
export function splitSqlStatements(sql: string): string[] {
  // Strip single-line comments (-- ...)
  const noLineComments = sql.replace(/--.*$/gm, "");
  // Strip block comments (/* ... */)
  const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, "");

  return noBlockComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Loads all matching *.up.sql and *.down.sql migration pairs from directory.
 */
export async function loadMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = await fs.readdir(migrationsDir);
  const upFiles = entries.filter((f) => f.endsWith(".up.sql")).sort();

  const migrations: MigrationFile[] = [];

  for (const upFile of upFiles) {
    const version = upFile.replace(/\.up\.sql$/, "");
    const downFile = `${version}.down.sql`;
    const upPath = path.join(migrationsDir, upFile);
    const downPath = path.join(migrationsDir, downFile);

    const upSql = await fs.readFile(upPath, "utf-8");
    let downSql = "";
    try {
      downSql = await fs.readFile(downPath, "utf-8");
    } catch {
      // Down migration optional or missing
    }

    migrations.push({
      version,
      upPath,
      downPath,
      upSql,
      downSql,
    });
  }

  return migrations;
}

/**
 * Ensures schema_migrations tracking table exists.
 */
async function ensureMigrationsTable(conn: PoolConnection | Pool): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await conn.query(sql);
}

/**
 * Execute all pending migrations in ascending order.
 */
export async function migrateUp(pool: Pool, migrationsDir: string): Promise<string[]> {
  await ensureMigrationsTable(pool);

  const [rows] = await pool.query<any[]>("SELECT version FROM schema_migrations");
  const appliedVersions = new Set(rows.map((r) => r.version));

  const migrations = await loadMigrationFiles(migrationsDir);
  const newlyApplied: string[] = [];

  for (const m of migrations) {
    if (!appliedVersions.has(m.version)) {
      const statements = splitSqlStatements(m.upSql);
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const stmt of statements) {
          await conn.query(stmt);
        }
        await conn.query("INSERT INTO schema_migrations (version) VALUES (?)", [m.version]);
        await conn.commit();
        newlyApplied.push(m.version);
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }
  }

  return newlyApplied;
}

/**
 * Rollback applied migrations in descending order.
 */
export async function migrateDown(pool: Pool, migrationsDir: string, steps: number = 1): Promise<string[]> {
  await ensureMigrationsTable(pool);

  const [rows] = await pool.query<any[]>("SELECT version FROM schema_migrations ORDER BY applied_at DESC, version DESC");
  const appliedVersions = rows.map((r) => r.version);

  const migrations = await loadMigrationFiles(migrationsDir);
  const migrationMap = new Map(migrations.map((m) => [m.version, m]));

  const rolledBack: string[] = [];
  const toRollback = appliedVersions.slice(0, steps);

  for (const version of toRollback) {
    const m = migrationMap.get(version);
    if (m && m.downSql) {
      const statements = splitSqlStatements(m.downSql);
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const stmt of statements) {
          await conn.query(stmt);
        }
        await conn.query("DELETE FROM schema_migrations WHERE version = ?", [version]);
        await conn.commit();
        rolledBack.push(version);
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }
  }

  return rolledBack;
}

