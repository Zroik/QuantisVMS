/**
 * AES-256-GCM Credential Encryption & Masking Utilities (Spec §10 item 6, §7, Gate G3.3).
 */

import crypto from "node:crypto";

const IV_LENGTH = 12; // 96 bits for AES-GCM
const TAG_LENGTH = 16; // 128 bits auth tag
const REDIS_ENC_PREFIX = "enc:v1:";

let devFallbackCredentialKey: Buffer | null = null;

/**
 * Validates and derives 32-byte key buffer from base64 string.
 * Refuses all-zero fallback and silent hash derivation.
 */
export function deriveCredentialKey(keyInput?: string): Buffer {
  const rawKey = keyInput || process.env.CREDENTIAL_KEY;
  if (!rawKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CREDENTIAL_KEY environment variable is mandatory in production");
    }
    if (!devFallbackCredentialKey) {
      devFallbackCredentialKey = crypto.randomBytes(32);
      console.warn(
        "[Credentials] CREDENTIAL_KEY is not set; generated ephemeral process-scoped 32-byte key for non-production runtime."
      );
    }
    return devFallbackCredentialKey;
  }
  const buf = Buffer.from(rawKey, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `Invalid CREDENTIAL_KEY: must decode to exactly 32 bytes (got ${buf.length}). Silent derivation is disabled.`
    );
  }
  if (buf.every((byte) => byte === 0)) {
    throw new Error(
      "Refusing to use an all-zero CREDENTIAL_KEY. Generate a random 32-byte base64 key (openssl rand -base64 32)."
    );
  }
  return buf;
}

/**
 * Encodes an AES-256-GCM encrypted buffer as a tagged base64 string for Redis storage.
 */
export function encodeEncryptedRtspForRedis(encryptedBuf: Buffer): string {
  return `${REDIS_ENC_PREFIX}${encryptedBuf.toString("base64")}`;
}

/**
 * Encrypts an RTSP URL with AES-256-GCM and encodes it for Redis storage.
 */
export function encryptRtspUrlForRedis(url: string, key?: Buffer): string {
  const resolvedKey = key ?? deriveCredentialKey();
  return encodeEncryptedRtspForRedis(encryptRtspUrl(url, resolvedKey));
}

/**
 * Decrypts a Redis-stored RTSP value (`enc:v1:<base64>`) back to plaintext in memory.
 */
export function decryptRtspUrlFromRedis(redisVal: string, key?: Buffer): string {
  const resolvedKey = key ?? deriveCredentialKey();
  if (redisVal.startsWith(REDIS_ENC_PREFIX)) {
    const b64 = redisVal.slice(REDIS_ENC_PREFIX.length);
    return decryptRtspUrl(Buffer.from(b64, "base64"), resolvedKey);
  }
  return decryptRtspUrl(Buffer.from(redisVal, "base64"), resolvedKey);
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
 *
 * Uses URL parsing so a password containing `@` cannot leak its tail (regex
 * splitting on the first `@` would expose the remainder).
 */
export function maskRtspUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) {
      return url;
    }
    parsed.username = "***";
    parsed.password = "***";
    return parsed.toString();
  } catch {
    // Fallback for inputs the WHATWG parser rejects: mask everything up to the
    // last `@` before the path/whitespace.
    return url.replace(/:\/\/[^\s/]*@/, "://***:***@");
  }
}

/**
 * Extracts host (with port if present) for public display without credentials or protocol.
 * Example: rtsp://admin:secret@192.168.1.1:554/live -> 192.168.1.1:554
 */
export function extractRtspHost(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (!host) {
      return "unknown-host";
    }
    return parsed.port ? `${host}:${parsed.port}` : host;
  } catch {
    return "unknown-host";
  }
}

