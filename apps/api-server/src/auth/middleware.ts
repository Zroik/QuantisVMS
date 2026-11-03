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

export function createAuthenticateMiddleware(allowQueryTokens = false) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers["authorization"];
    const headerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const queryToken = allowQueryTokens
      ? (typeof req.query.jwt === "string" ? req.query.jwt : null) ||
        (typeof req.query.token === "string" ? req.query.token : null)
      : null;
    const token = headerToken || queryToken;

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
  };
}

export const authenticateToken = createAuthenticateMiddleware(false);
export const authenticateMediaToken = createAuthenticateMiddleware(true);

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
  keyGenerator?: (req: Request) => string;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const { windowSec, maxRequests, keyPrefix = "rl", keyGenerator } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only trust req.ip (Express trust proxy configuration) to prevent spoofable header bypass
    let ip = req.ip || req.socket.remoteAddress || "unknown";
    if (ip.startsWith("::ffff:")) {
      ip = ip.substring(7);
    }
    const key = `ratelimit:${keyPrefix}:${keyGenerator ? keyGenerator(req) : ip}`;

    try {
      const redis = getRedisClient();
      const pipeline = redis.multi();
      pipeline.incr(key);
      pipeline.ttl(key);
      const results = await pipeline.exec();
      const current = (results?.[0]?.[1] as number) || 1;
      let ttl = (results?.[1]?.[1] as number) || -1;

      if (current === 1 || ttl === -1) {
        await redis.expire(key, windowSec);
        ttl = windowSec;
      }

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
