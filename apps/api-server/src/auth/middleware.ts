import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, decodeMediaTicket, type UserPayload } from "./service.js";
import { getRedisClient } from "../redis/client.js";

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

const RATE_LIMIT_LUA = `
local current = redis.call("INCR", KEYS[1])
local ttl = redis.call("TTL", KEYS[1])
if current == 1 or ttl < 0 then
  redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

export function createAuthenticateMiddleware(allowMediaTickets = false) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers["authorization"];
    const headerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (headerToken) {
      try {
        const user = await verifyAccessToken(headerToken);
        req.user = user;
        next();
        return;
      } catch {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
    }

    if (allowMediaTickets) {
      const ticketParam = typeof req.query.ticket === "string" ? req.query.ticket : null;
      if (ticketParam) {
        const paramId = Number(req.params?.id);
        const pathMatch = (req.path || "").match(/^\/(\d+)\/(?:stream|download)$/);
        const recordingId = !isNaN(paramId) && paramId > 0 ? paramId : Number(pathMatch?.[1] || 0);
        const ticketUser = recordingId > 0 ? decodeMediaTicket(ticketParam, recordingId) : null;
        if (!ticketUser) {
          res.status(401).json({ error: "Invalid or expired media ticket" });
          return;
        }
        req.user = ticketUser;
        next();
        return;
      }

      const queryToken = typeof req.query.token === "string" ? req.query.token : null;
      if (queryToken) {
        try {
          const user = await verifyAccessToken(queryToken);
          req.user = user;
          next();
          return;
        } catch {
          res.status(401).json({ error: "Invalid or expired token" });
          return;
        }
      }
    }

    res.status(401).json({ error: "Missing authentication token" });
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
      let current = 1;
      let ttl = windowSec;

      if (typeof (redis as any).eval === "function") {
        const evalRes = (await (redis as any).eval(
          RATE_LIMIT_LUA,
          1,
          key,
          String(windowSec)
        )) as [number, number];
        current = Number(evalRes?.[0]) || 1;
        ttl = Number(evalRes?.[1]) || windowSec;
      } else {
        const pipeline = redis.multi();
        pipeline.incr(key);
        pipeline.ttl(key);
        const results = await pipeline.exec();
        current = (results?.[0]?.[1] as number) || 1;
        ttl = (results?.[1]?.[1] as number) || -1;
        if (current === 1 || ttl < 0) {
          await redis.expire(key, windowSec);
          ttl = windowSec;
        }
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
