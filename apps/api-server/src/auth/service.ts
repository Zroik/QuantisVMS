import argon2 from "argon2";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { getRedisClient } from "../redis/client.js";
import { getDbPool } from "../db/connection.js";
import { assertSecureConfig } from "../config/validate.js";

export interface UserPayload {
  userId: number;
  username: string;
  role: "admin" | "viewer";
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

let ephemeralDevJwtSecret: string | null = null;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET environment variable is mandatory in production");
    }
    if (!ephemeralDevJwtSecret) {
      ephemeralDevJwtSecret = crypto.randomBytes(32).toString("hex");
      console.warn(
        "[Auth] WARNING: JWT_SECRET is not set; generated ephemeral process-scoped secret for non-production runtime."
      );
    }
    return ephemeralDevJwtSecret;
  }
  assertSecureConfig(process.env, { jwt: true });
  return secret;
}

const DEFAULT_ACCESS_EXPIRES_SEC = Number(process.env.JWT_ACCESS_EXPIRES_SEC) || 900; // 15 mins
const DEFAULT_REFRESH_EXPIRES_SEC = Number(process.env.JWT_REFRESH_EXPIRES_SEC) || 604800; // 7 days

let cachedAccessExpiresSec = DEFAULT_ACCESS_EXPIRES_SEC;
let cachedRefreshExpiresSec = DEFAULT_REFRESH_EXPIRES_SEC;
let securityConfigFetchedAtMs = 0;
let securityConfigExplicitlySet = false;

export function setSecurityTokenLifetimes(config?: {
  jwtAccessExpiryMin?: number;
  jwtRefreshExpiryDays?: number;
} | null): void {
  if (!config) {
    cachedAccessExpiresSec = DEFAULT_ACCESS_EXPIRES_SEC;
    cachedRefreshExpiresSec = DEFAULT_REFRESH_EXPIRES_SEC;
    securityConfigFetchedAtMs = Date.now();
    securityConfigExplicitlySet = false;
    return;
  }
  if (typeof config.jwtAccessExpiryMin === "number" && config.jwtAccessExpiryMin > 0) {
    cachedAccessExpiresSec = Math.round(config.jwtAccessExpiryMin * 60);
  }
  if (typeof config.jwtRefreshExpiryDays === "number" && config.jwtRefreshExpiryDays > 0) {
    cachedRefreshExpiresSec = Math.round(config.jwtRefreshExpiryDays * 86400);
  }
  securityConfigFetchedAtMs = Date.now();
  securityConfigExplicitlySet = true;
}

export async function getSecurityTokenLifetimes(): Promise<{
  accessExpiresSec: number;
  refreshExpiresSec: number;
}> {
  const now = Date.now();
  if (!securityConfigExplicitlySet && now - securityConfigFetchedAtMs > 60_000) {
    securityConfigFetchedAtMs = now;
    try {
      const pool = getDbPool();
      const [rows] = await pool.query<any[]>(
        "SELECT config_value FROM system_config WHERE config_key = 'security' LIMIT 1"
      );
      if (rows.length > 0 && rows[0].config_value) {
        const parsed =
          typeof rows[0].config_value === "string"
            ? JSON.parse(rows[0].config_value)
            : rows[0].config_value;
        if (typeof parsed?.jwtAccessExpiryMin === "number" && parsed.jwtAccessExpiryMin > 0) {
          cachedAccessExpiresSec = Math.round(parsed.jwtAccessExpiryMin * 60);
        }
        if (typeof parsed?.jwtRefreshExpiryDays === "number" && parsed.jwtRefreshExpiryDays > 0) {
          cachedRefreshExpiresSec = Math.round(parsed.jwtRefreshExpiryDays * 86400);
        }
      }
    } catch {
      // Fall back to cached or env values if DB is unreachable or not initialized
    }
  }
  return {
    accessExpiresSec: cachedAccessExpiresSec,
    refreshExpiresSec: cachedRefreshExpiresSec,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export async function generateTokens(user: UserPayload): Promise<TokenPair> {
  const jti = crypto.randomUUID();
  const secret = getJwtSecret();
  const { accessExpiresSec, refreshExpiresSec } = await getSecurityTokenLifetimes();

  const accessToken = jwt.sign(
    {
      userId: user.userId,
      username: user.username,
      role: user.role,
      typ: "access",
    },
    secret,
    { expiresIn: accessExpiresSec }
  );

  const refreshToken = jwt.sign(
    {
      userId: user.userId,
      username: user.username,
      role: user.role,
      typ: "refresh",
      jti,
    },
    secret,
    { expiresIn: refreshExpiresSec }
  );

  // Store active refresh token jti in Redis with TTL and maintain user JTI set
  const redis = getRedisClient();
  const redisKey = `auth:refresh:${user.userId}:${jti}`;
  const setKey = `auth:refresh:set:${user.userId}`;
  await redis.set(redisKey, "1", "EX", refreshExpiresSec);
  await redis.sadd(setKey, jti);
  // Keep the JTI set bounded: without a TTL it grows forever.
  await redis.expire(setKey, refreshExpiresSec);

  return {
    accessToken,
    refreshToken,
    expiresIn: accessExpiresSec,
  };
}

export function signMediaTicket(
  userId: number,
  recordingId: number,
  ttlSec: number = 60,
  role: "admin" | "viewer" = "viewer",
  username: string = "user"
): string {
  const secret = getJwtSecret();
  return jwt.sign(
    {
      userId: Number(userId),
      username,
      role,
      recId: Number(recordingId),
      typ: "media_ticket",
      purpose: "media_stream",
    },
    secret,
    { expiresIn: Math.max(1, Math.min(300, Math.floor(ttlSec))) }
  );
}

export function decodeMediaTicket(ticket: string, recordingId: number): UserPayload | null {
  try {
    const decoded = jwt.verify(ticket, getJwtSecret()) as any;
    if (decoded?.typ !== "media_ticket" || decoded?.purpose !== "media_stream") {
      return null;
    }
    if (Number(decoded.recId) !== Number(recordingId) || !decoded.userId) {
      return null;
    }
    return {
      userId: Number(decoded.userId),
      username: String(decoded.username || "user"),
      role: decoded.role === "admin" ? "admin" : "viewer",
    };
  } catch {
    return null;
  }
}

export function verifyMediaTicket(ticket: string, recordingId: number): boolean {
  return decodeMediaTicket(ticket, recordingId) !== null;
}

export async function verifyAccessToken(token: string): Promise<UserPayload> {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as any;
    if (decoded.typ !== "access" || decoded.jti) {
      throw new Error("Not an access token");
    }
    if (!decoded.userId || !decoded.username || !decoded.role) {
      throw new Error("Invalid token payload");
    }
    return {
      userId: Number(decoded.userId),
      username: decoded.username,
      role: decoded.role,
    };
  } catch (err: any) {
    throw new Error(`Invalid access token: ${err.message}`);
  }
}

export async function rotateRefreshToken(token: string): Promise<TokenPair> {
  let decoded: any;
  try {
    decoded = jwt.verify(token, getJwtSecret());
  } catch (err: any) {
    throw new Error("Invalid or expired refresh token");
  }

  const { userId, jti, typ } = decoded;
  if (typ !== "refresh" || !userId || !jti) {
    throw new Error("Invalid token format");
  }

  const redis = getRedisClient();
  const redisKey = `auth:refresh:${userId}:${jti}`;
  const setKey = `auth:refresh:set:${userId}`;

  // Atomic get and delete (single-use token rotation)
  const exists = await redis.del(redisKey);
  await redis.srem(setKey, jti);

  if (!exists) {
    // Possible token reuse / breach: revoke all refresh tokens for this user via JTI set
    const jtis = await redis.smembers(setKey);
    if (jtis.length > 0) {
      const keysToDelete = jtis.map((id) => `auth:refresh:${userId}:${id}`);
      await redis.del(...keysToDelete);
    }
    await redis.del(setKey);
    throw new Error("Refresh token already used or revoked");
  }

  // Always re-read current user from database to ensure fresh role and active account status
  const pool = getDbPool();
  const [rows] = await pool.query<any[]>(
    "SELECT username, role FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (rows.length === 0) {
    throw new Error("User no longer exists");
  }

  const currentRole = rows[0].role as "admin" | "viewer";
  const currentUsername = String(rows[0].username);

  // Issue new token pair
  return generateTokens({ userId: Number(userId), username: currentUsername, role: currentRole });
}

export async function revokeRefreshToken(token: string): Promise<void> {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as any;
    if (decoded?.userId && decoded?.jti) {
      const redis = getRedisClient();
      await redis.del(`auth:refresh:${decoded.userId}:${decoded.jti}`);
      await redis.srem(`auth:refresh:set:${decoded.userId}`, decoded.jti);
    }
  } catch {
    // Silent on invalid token
  }
}

