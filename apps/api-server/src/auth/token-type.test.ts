import { describe, it, expect, beforeAll } from "vitest";
import jwt from "jsonwebtoken";
import { verifyAccessToken, getJwtSecret } from "./service.js";

describe("JWT token-type separation (BE-S4)", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "unit-test-secret-that-is-long-enough-1234567890";
  });

  const sign = (payload: Record<string, unknown>) => jwt.sign(payload, getJwtSecret(), { expiresIn: 60 });

  it("accepts an access token", async () => {
    const token = sign({ userId: 1, username: "admin", role: "admin", typ: "access" });
    await expect(verifyAccessToken(token)).resolves.toMatchObject({ userId: 1, role: "admin" });
  });

  it("rejects a refresh token used as an access token", async () => {
    const token = sign({ userId: 1, username: "admin", role: "admin", typ: "refresh", jti: "abc" });
    await expect(verifyAccessToken(token)).rejects.toThrow(/access token/i);
  });

  it("rejects an untagged legacy token", async () => {
    const token = sign({ userId: 1, username: "admin", role: "admin" });
    await expect(verifyAccessToken(token)).rejects.toThrow(/access token/i);
  });
});
