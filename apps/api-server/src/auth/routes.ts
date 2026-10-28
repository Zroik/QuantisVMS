import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getDbPool } from "../db/connection.js";
import {
  verifyPassword,
  generateTokens,
  rotateRefreshToken,
  revokeRefreshToken,
} from "./service.js";
import { authenticateToken, createRateLimiter } from "./middleware.js";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// Gate G3.2: Rate limiter on login (e.g. 5 attempts / 60 seconds)
const loginLimiter = createRateLimiter({
  windowSec: 60,
  maxRequests: 5,
  keyPrefix: "login",
});

authRouter.post("/login", loginLimiter, async (req: Request, res: Response): Promise<void> => {
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

  res.json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  });
});

authRouter.post("/refresh", async (req: Request, res: Response): Promise<void> => {
  const parseResult = refreshSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.issues });
    return;
  }

  try {
    const tokens = await rotateRefreshToken(parseResult.data.refreshToken);
    res.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });
  } catch (err: any) {
    res.status(401).json({ error: err.message || "Invalid refresh token" });
  }
});

authRouter.post("/logout", async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body || {};
  if (refreshToken && typeof refreshToken === "string") {
    await revokeRefreshToken(refreshToken);
  }
  res.json({ ok: true });
});

authRouter.get("/me", authenticateToken, (req: Request, res: Response): void => {
  res.json({ user: req.user });
});
