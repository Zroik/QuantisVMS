#!/usr/bin/env node
/**
 * Generate `.env` from `.env.example`, filling every secret with a fresh
 * cryptographically-random value. The stack fails closed without real secrets,
 * so this is the supported first-run step (see README step 2).
 *
 * Usage:
 *   node scripts/gen-env.mjs            # create .env (refuses to overwrite)
 *   node scripts/gen-env.mjs --force    # overwrite an existing .env
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = path.join(repoRoot, ".env.example");
const envPath = path.join(repoRoot, ".env");

if (!fs.existsSync(examplePath)) {
  console.error("[env] .env.example not found at repository root.");
  process.exit(1);
}

if (fs.existsSync(envPath) && !process.argv.includes("--force")) {
  console.error("[env] .env already exists. Re-run with --force to overwrite it.");
  process.exit(1);
}

const base64 = (bytes) => crypto.randomBytes(bytes).toString("base64");
const hex = (bytes) => crypto.randomBytes(bytes).toString("hex");

// CREDENTIAL_KEY must decode to exactly 32 bytes (see crypto/credentials.ts).
const secrets = {
  JWT_SECRET: base64(48),
  CREDENTIAL_KEY: base64(32),
  MYSQL_PASSWORD: hex(24),
  MYSQL_ROOT_PASSWORD: hex(24),
  REDIS_PASSWORD: hex(24),
  MEDIAMTX_AUTH_SECRET: hex(24),
};

let out = fs.readFileSync(examplePath, "utf8");
for (const [key, value] of Object.entries(secrets)) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(out)) {
    out = out.replace(pattern, `${key}=${value}`);
  } else {
    out += `${out.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
  }
}

fs.writeFileSync(envPath, out);
console.log(`[env] Wrote ${path.relative(repoRoot, envPath)} with generated secrets.`);
console.log("[env] Review it (ports, storage paths, optional SEED_CAM*), then: docker compose up -d");
