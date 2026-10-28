import { describe, it, expect } from "vitest";
import {
  encryptRtspUrl,
  decryptRtspUrl,
  maskRtspUrl,
  extractRtspHost,
  deriveCredentialKey,
} from "./credentials.js";

describe("RTSP Credentials Security (Spec §10 item 6, Gate G3.3)", () => {
  // 32-byte key encoded in Base64
  const testKeyBase64 = Buffer.from("01234567890123456789012345678901").toString("base64");
  const testKey = deriveCredentialKey(testKeyBase64);

  const rawUrl = "rtsp://admin:Sby09300116%40@192.168.100.67:554/Streaming/Channels/101";

  it("encrypts and decrypts RTSP URL with AES-256-GCM reversibly", () => {
    const encrypted = encryptRtspUrl(rawUrl, testKey);
    expect(Buffer.isBuffer(encrypted)).toBe(true);
    // IV (12) + Tag (16) + Ciphertext (> 0)
    expect(encrypted.length).toBeGreaterThan(28);

    // Verify ciphertext does not contain plaintext password
    expect(encrypted.toString("utf-8")).not.toContain("Sby09300116");
    expect(encrypted.toString("utf-8")).not.toContain("admin");

    // Decrypt and verify exact match
    const decrypted = decryptRtspUrl(encrypted, testKey);
    expect(decrypted).toBe(rawUrl);
  });

  it("produces different ciphertexts for the same plaintext due to random IV", () => {
    const enc1 = encryptRtspUrl(rawUrl, testKey);
    const enc2 = encryptRtspUrl(rawUrl, testKey);
    expect(enc1.equals(enc2)).toBe(false);

    expect(decryptRtspUrl(enc1, testKey)).toBe(rawUrl);
    expect(decryptRtspUrl(enc2, testKey)).toBe(rawUrl);
  });

  it("fails decryption if ciphertext or authentication tag is tampered", () => {
    const encrypted = encryptRtspUrl(rawUrl, testKey);
    // Tamper with last byte
    encrypted[encrypted.length - 1] ^= 0xff;
    expect(() => decryptRtspUrl(encrypted, testKey)).toThrow();
  });

  it("masks credentials in RTSP URL (maskRtspUrl)", () => {
    const masked = maskRtspUrl(rawUrl);
    expect(masked).toBe("rtsp://***:***@192.168.100.67:554/Streaming/Channels/101");
    expect(masked).not.toContain("Sby09300116");
    expect(masked).not.toContain("admin");

    // URL without credentials remains unchanged
    expect(maskRtspUrl("rtsp://mediamtx:8554/cam1")).toBe("rtsp://mediamtx:8554/cam1");
  });

  it("extracts display host without credentials (extractRtspHost)", () => {
    const host = extractRtspHost(rawUrl);
    expect(host).toBe("192.168.100.67:554");
    expect(host).not.toContain("Sby09300116");
    expect(host).not.toContain("admin");
    expect(host).not.toContain("rtsp://");
  });

  it("handles IPv6 and domain names in host extraction", () => {
    expect(extractRtspHost("rtsp://user:pass@camera.local:8554/live")).toBe("camera.local:8554");
    expect(extractRtspHost("rtsps://user:pass@[::1]:554/live")).toBe("[::1]:554");
  });
});

