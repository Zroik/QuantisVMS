import crypto from "node:crypto";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function deriveCredentialKey(keyInput?: string): Buffer {
  const rawKey = keyInput || process.env.CREDENTIAL_KEY;
  if (!rawKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CREDENTIAL_KEY environment variable is mandatory in production");
    }
    return Buffer.from("01234567890123456789012345678901", "utf-8");
  }
  const buf = Buffer.from(rawKey, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `Invalid CREDENTIAL_KEY: must decode to exactly 32 bytes (got ${buf.length}). Silent derivation is disabled.`
    );
  }
  return buf;
}

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

