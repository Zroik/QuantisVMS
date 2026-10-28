import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type UserPayload } from "./service.js";
import { getRedisClient } from "../redis/client.js";

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Missing authentication token" });
    return;
  }

  try {
    const user = await verifyAccessToken(token);
    req.user = user;
    next();
  } catch (err: any) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(requiredRole: "admin" | "viewer") {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (requiredRole === "admin" && req.user.role !== "admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }

    next();
  };
}

export interface RateLimiterOptions {
  windowSec: number;
  maxRequests: number;
  keyPrefix?: string;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const { windowSec, maxRequests, keyPrefix = "rl" } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let ip = (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "unknown";
    if (ip.startsWith("::ffff:")) {
      ip = ip.substring(7);
    }
    const key = `ratelimit:${keyPrefix}:${ip}`;

    try {
      const redis = getRedisClient();
      const current = await redis.incr(key);

      if (current === 1) {
        await redis.expire(key, windowSec);
      }

      const ttl = await redis.ttl(key);
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - current));

      if (current > maxRequests) {
        res.setHeader("Retry-After", ttl > 0 ? ttl : windowSec);
        res.status(429).json({
          error: "Too many requests, please try again later",
          retryAfterSec: ttl > 0 ? ttl : windowSec,
        });
        return;
      }

      next();
    } catch {
      // If Redis is momentarily down, fail open so legitimate traffic isn't completely dropped
      next();
    }
  };
}
