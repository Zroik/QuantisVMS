import argon2 from "argon2";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { getRedisClient } from "../redis/client.js";

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

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-jwt-key-replace-in-production-min-32-chars";
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

  const accessToken = jwt.sign(
    {
      userId: user.userId,
      username: user.username,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: ACCESS_EXPIRES_SEC }
  );

  const refreshToken = jwt.sign(
    {
      userId: user.userId,
      username: user.username,
      role: user.role,
      jti,
    },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRES_SEC }
  );

  // Store active refresh token jti in Redis with TTL
  const redis = getRedisClient();
  const redisKey = `auth:refresh:${user.userId}:${jti}`;
  await redis.set(redisKey, "1", "EX", REFRESH_EXPIRES_SEC);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_EXPIRES_SEC,
  };
}

export async function verifyAccessToken(token: string): Promise<UserPayload> {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
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
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err: any) {
    throw new Error("Invalid or expired refresh token");
  }

  const { userId, username, role, jti } = decoded;
  if (!userId || !jti) {
    throw new Error("Invalid token format");
  }

  const redis = getRedisClient();
  const redisKey = `auth:refresh:${userId}:${jti}`;

  // Atomic get and delete (single-use token rotation)
  const exists = await redis.del(redisKey);
  if (!exists) {
    // Possible token reuse / breach: revoke all refresh tokens for this user
    const userPattern = `auth:refresh:${userId}:*`;
    const keys = await redis.keys(userPattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    throw new Error("Refresh token already used or revoked");
  }

  // Issue new token pair
  return generateTokens({ userId: Number(userId), username, role });
}

export async function revokeRefreshToken(token: string): Promise<void> {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded?.userId && decoded?.jti) {
      const redis = getRedisClient();
      await redis.del(`auth:refresh:${decoded.userId}:${decoded.jti}`);
    }
  } catch {
    // Silent on invalid token
  }
}
