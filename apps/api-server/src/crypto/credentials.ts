/**
 * AES-256-GCM Credential Encryption & Masking Utilities (Spec §10 item 6, §7, Gate G3.3).
 */

import crypto from "node:crypto";

const IV_LENGTH = 12; // 96 bits for AES-GCM
const TAG_LENGTH = 16; // 128 bits auth tag

/**
 * Validates and derives 32-byte key buffer from base64 or raw string.
 */
export function deriveCredentialKey(keyInput?: string): Buffer {
  const rawKey = keyInput || process.env.CREDENTIAL_KEY || "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const buf = Buffer.from(rawKey, "base64");
  if (buf.length === 32) {
    return buf;
  }
  // Fallback to SHA-256 derivation if length is not exactly 32 bytes
  return crypto.createHash("sha256").update(rawKey).digest();
}

/**
 * Encrypts full RTSP URL using AES-256-GCM.
 * Output binary format: [12-byte IV][16-byte Auth Tag][Ciphertext]
 */
export function encryptRtspUrl(url: string, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(url, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Decrypts binary buffer produced by encryptRtspUrl into plaintext RTSP URL.
 * Throws if auth tag verification fails or buffer is truncated.
 */
export function decryptRtspUrl(encrypted: Buffer, key: Buffer): string {
  if (encrypted.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid encrypted buffer: truncated header");
  }

  const iv = encrypted.subarray(0, IV_LENGTH);
  const tag = encrypted.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

/**
 * Masks credentials in RTSP URL for safe logging and API display (Spec §10 item 6).
 * Example: rtsp://admin:secret@192.168.1.1:554/live -> rtsp://***:***@192.168.1.1:554/live
 */
export function maskRtspUrl(url: string): string {
  return url.replace(/:\/\/[^:]+:[^@]+@/, "://***:***@");
}

/**
 * Extracts host (with port if present) for public display without credentials or protocol.
 * Example: rtsp://admin:secret@192.168.1.1:554/live -> 192.168.1.1:554
 */
export function extractRtspHost(url: string): string {
  try {
    // Strip scheme
    const withoutScheme = url.replace(/^[a-zA-Z0-9+.-]+:\/\//, "");
    // Extract authority component (before path or query)
    const authority = withoutScheme.split("/")[0]?.split("?")[0] || "";
    // Strip userinfo if present
    const hostPart = authority.includes("@") ? authority.split("@")[1] : authority;
    return hostPart || "unknown-host";
  } catch {
    return "unknown-host";
  }
}

