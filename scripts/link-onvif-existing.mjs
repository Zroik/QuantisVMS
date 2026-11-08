import mysql from "mysql2/promise";
import crypto from "node:crypto";

/**
 * Dev helper: attach ONVIF metadata to already-seeded cameras.
 * Configured entirely through environment variables (see .env.example); no
 * credentials or hosts are hardcoded here.
 */
const IV_LENGTH = 12;

const rawKey = process.env.CREDENTIAL_KEY;
if (!rawKey) {
  console.error("CREDENTIAL_KEY is required (see .env.example). Refusing to run with a default key.");
  process.exit(1);
}
const key = Buffer.from(rawKey, "base64");
if (key.length !== 32) {
  console.error(`CREDENTIAL_KEY must decode to exactly 32 bytes (got ${key.length}).`);
  process.exit(1);
}

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

async function run() {
  const password = process.env.MYSQL_PASSWORD;
  if (!password) {
    console.error("MYSQL_PASSWORD is required (see .env.example).");
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "mysql",
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER || "vms_user",
    password,
    database: process.env.MYSQL_DATABASE || "vms_db",
  });

  // Camera 1 — configure through SEED_CAM1_* env variables.
  const cam1Xaddr = process.env.SEED_CAM1_ONVIF_XADDR;
  if (cam1Xaddr) {
    const passEnc = encrypt(process.env.SEED_CAM1_ONVIF_PASS || "");
    const caps = JSON.stringify({ ptz: false, imaging: true, events: true });
    await conn.query(
      "UPDATE cameras SET onvif_xaddr = ?, onvif_user = ?, onvif_pass_enc = ?, onvif_capabilities = ? WHERE id = ?",
      [cam1Xaddr, process.env.SEED_CAM1_ONVIF_USER || "admin", passEnc, caps, 1]
    );
    console.log("Updated camera 1 ONVIF record.");
  }

  // Cameras 2 & 10 — configure through SEED_CAM2_* env variables.
  const cam2Xaddr = process.env.SEED_CAM2_ONVIF_XADDR;
  if (cam2Xaddr) {
    const passEnc = encrypt(process.env.SEED_CAM2_ONVIF_PASS || "");
    const caps = JSON.stringify({ ptz: true, imaging: true, events: true });
    await conn.query(
      "UPDATE cameras SET onvif_xaddr = ?, onvif_user = ?, onvif_pass_enc = ?, onvif_capabilities = ? WHERE id IN (2, 10)",
      [cam2Xaddr, process.env.SEED_CAM2_ONVIF_USER || "admin", passEnc, caps]
    );
    console.log("Updated cameras 2 and 10 ONVIF records.");
  }

  await conn.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
