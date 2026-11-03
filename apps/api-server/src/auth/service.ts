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

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET environment variable is mandatory in production");
    }
    return "super-secret-jwt-key-replace-in-production-min-32-chars";
  }
  assertSecureConfig(process.env, { jwt: true });
  return secret;
}

const ACCESS_EXPIRES_SEC = Number(process.env.JWT_ACCESS_EXPIRES_SEC) || 900; // 15 mins
const REFRESH_EXPIRES_SEC = Number(process.env.JWT_REFRESH_EXPIRES_SEC) || 604800; // 7 days

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

  const accessToken = jwt.sign(
    {
      userId: user.userId,
      username: user.username,
      role: user.role,
      typ: "access",
    },
    secret,
    { expiresIn: ACCESS_EXPIRES_SEC }
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
    { expiresIn: REFRESH_EXPIRES_SEC }
  );

  // Store active refresh token jti in Redis with TTL and maintain user JTI set
  const redis = getRedisClient();
  const redisKey = `auth:refresh:${user.userId}:${jti}`;
  const setKey = `auth:refresh:set:${user.userId}`;
  await redis.set(redisKey, "1", "EX", REFRESH_EXPIRES_SEC);
  await redis.sadd(setKey, jti);
  // Keep the JTI set bounded: without a TTL it grows forever.
  await redis.expire(setKey, REFRESH_EXPIRES_SEC);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_EXPIRES_SEC,
  };
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

