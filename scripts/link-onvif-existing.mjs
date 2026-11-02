import mysql from "mysql2/promise";
import crypto from "node:crypto";

const IV_LENGTH = 12;
const rawKey = process.env.CREDENTIAL_KEY || "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const key = Buffer.from(rawKey, "base64");

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "mysql",
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: "vms_user",
    password: "vms_password_secret",
    database: "vms_db"
  });

  // Hikvision (Cam 1)
  const hikPassEnc = encrypt("REDACTED-LEAKED-PASSWORD@");
  const hikCaps = JSON.stringify({
    ptz: false,
    imaging: true,
    events: true,
    mediaUrl: "http://192.168.100.67/onvif/Media",
    imagingUrl: "http://192.168.100.67/onvif/Imaging"
  });

  await conn.query(
    "UPDATE cameras SET onvif_xaddr = ?, onvif_user = ?, onvif_pass_enc = ?, onvif_capabilities = ? WHERE id = 1",
    ["http://192.168.100.67/onvif/device_service", "admin", hikPassEnc, hikCaps]
  );
  console.log("Updated Hikvision (Cam 1)");

  // v380 pro (Cam 2 & 10)
  const v380PassEnc = encrypt("");
  const v380Caps = JSON.stringify({
    ptz: true,
    imaging: true,
    events: true,
    mediaUrl: "http://192.168.100.16:8899/onvif/media_service",
    imagingUrl: "http://192.168.100.16:8899/onvif/imaging_service",
    ptzUrl: "http://192.168.100.16:8899/onvif/ptz_service"
  });

  await conn.query(
    "UPDATE cameras SET onvif_xaddr = ?, onvif_user = ?, onvif_pass_enc = ?, onvif_capabilities = ? WHERE id IN (2, 10)",
    ["http://192.168.100.16:8899/onvif/device_service", "admin", v380PassEnc, v380Caps]
  );
  console.log("Updated v380 pro (Cam 2, 10)");

  await conn.end();
}

run().catch(console.error);
