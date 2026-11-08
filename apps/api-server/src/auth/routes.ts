import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getDbPool } from "../db/connection.js";
import {
  hashPassword,
  verifyPassword,
  generateTokens,
  rotateRefreshToken,
  revokeRefreshToken,
} from "./service.js";
import { authenticateToken, createRateLimiter, resolveClientIp } from "./middleware.js";
import { getRedisClient } from "../redis/client.js";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// Per-IP cap (defeats username rotation) plus a per-(IP, username) cap
// (defeats targeted password guessing). The username is truncated before
// keying so an oversized body cannot create unbounded Redis keys.
const loginIpLimiter = createRateLimiter({
  windowSec: 60,
  maxRequests: 20,
  keyPrefix: "login-ip",
  failClosed: true,
});
const loginLimiter = createRateLimiter({
  windowSec: 60,
  maxRequests: 5,
  keyPrefix: "login",
  failClosed: true,
  keyGenerator: (req) =>
    `${resolveClientIp(req)}:${String((req.body as any)?.username ?? "").slice(0, 64).toLowerCase()}`,
});

authRouter.post("/login", loginIpLimiter, loginLimiter, async (req: Request, res: Response): Promise<void> => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.issues });
    return;
  }

  const { username, password } = parseResult.data;
  const pool = getDbPool();

  const [rows] = await pool.query<any[]>(
    "SELECT id, username, password_hash, role FROM users WHERE username = ? LIMIT 1",
    [username]
  );

  if (rows.length === 0) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const user = rows[0];
  const isValid = await verifyPassword(user.password_hash, password);
  if (!isValid) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const tokens = await generateTokens({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  const isSecure = process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";
  res.cookie("refreshToken", tokens.refreshToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  });
});

function parseCookieToken(cookieHeader?: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/(?:^|;\s*)refreshToken=([^;]+)/);
  if (!match || !match[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

const updatePasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  currentPassword: z.string().min(1, "Current password is required"),
});

authRouter.post("/refresh", async (req: Request, res: Response): Promise<void> => {
  const cookieToken = parseCookieToken(req.headers.cookie);
  const providedToken = cookieToken;

  if (!providedToken) {
    res.status(400).json({ error: "Validation failed: missing refresh token" });
    return;
  }

  try {
    const tokens = await rotateRefreshToken(providedToken);
    const isSecure = process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";
    res.cookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: isSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    });
  } catch (err: any) {
    res.status(401).json({ error: err.message || "Invalid refresh token" });
  }
});

authRouter.post("/logout", async (req: Request, res: Response): Promise<void> => {
  const cookieToken = parseCookieToken(req.headers.cookie);
  const token = req.body?.refreshToken || cookieToken;
  if (token && typeof token === "string") {
    await revokeRefreshToken(token);
  }
  const isSecure = process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";
  res.clearCookie("refreshToken", {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecure,
  });
  res.json({ ok: true });
});

authRouter.get("/me", authenticateToken, (req: Request, res: Response): void => {
  const user = req.user!;
  res.json({ user: { id: user.userId, userId: user.userId, username: user.username, role: user.role } });
});

authRouter.post("/update-password", authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const parseResult = updatePasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.issues });
    return;
  }

  const { password: newPassword, currentPassword } = parseResult.data;
  const userId = req.user!.userId;
  const pool = getDbPool();

  const [rows] = await pool.query<any[]>("SELECT password_hash FROM users WHERE id = ? LIMIT 1", [userId]);
  if (rows.length === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const isValid = await verifyPassword(rows[0].password_hash, currentPassword);
  if (!isValid) {
    res.status(401).json({ error: "Kata sandi saat ini tidak valid" });
    return;
  }

  const hashed = await hashPassword(newPassword);
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [hashed, userId]);

  // Revoke every refresh token for this user.
  const redis = getRedisClient();
  const setKey = `auth:refresh:set:${userId}`;
  const jtis = await redis.smembers(setKey);
  if (jtis.length > 0) {
    await redis.del(...jtis.map((jti) => `auth:refresh:${userId}:${jti}`));
  }
  await redis.del(setKey);

  res.json({ ok: true, message: "Kata sandi berhasil diperbarui" });
});

