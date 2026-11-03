import mysql, { type Pool } from "mysql2/promise";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    if (process.env.NODE_ENV === "production" && !process.env.MYSQL_PASSWORD) {
      throw new Error("MYSQL_PASSWORD environment variable is mandatory in production");
    }
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || "vms_user",
      password: process.env.MYSQL_PASSWORD || "vms_password_secret",
      database: process.env.MYSQL_DATABASE || "vms_db",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return pool;
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
