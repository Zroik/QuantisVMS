import crypto from "node:crypto";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function deriveCredentialKey(keyInput?: string): Buffer {
  const rawKey = keyInput || process.env.CREDENTIAL_KEY || "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const buf = Buffer.from(rawKey, "base64");
  if (buf.length === 32) {
    return buf;
  }
  return crypto.createHash("sha256").update(rawKey).digest();
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

