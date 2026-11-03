import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { getDbPool } from "../db/connection.js";
import { verifyPassword, verifyAccessToken } from "../auth/service.js";
import { createRateLimiter } from "../auth/middleware.js";

export const internalRouter = Router();

function getInternalAuthSecret(): string | null {
  const secret = process.env.MEDIAMTX_AUTH_SECRET;
  if (!secret) {
    console.error("[MediaMTX Auth] MEDIAMTX_AUTH_SECRET is not set; refusing all MediaMTX auth requests.");
    return null;
  }
  return secret;
}

export function isValidStreamPath(pathValue: unknown): boolean {
  return typeof pathValue === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(pathValue);
}

export function isAllowedMediaMtxAction(action: unknown): action is string {
  return (
    typeof action === "string" &&
    ["read", "playback", "publish", "api", "metrics", "pprof"].includes(action)
  );
}

export function isReadOnlyMediaMtxAction(action: unknown): boolean {
  return action === "read" || action === "playback";
}

function safeSecretCompare(provided?: string, expected?: string | null): boolean {
  if (!provided || !expected) return false;
  const bufA = Buffer.from(provided, "utf-8");
  const bufB = Buffer.from(expected, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const authLimiter = createRateLimiter({
  windowSec: 60,
  // HLS/LL-HLS authenticates per segment/part; one source IP (MediaMTX) serves
  // every viewer, so a low global bucket breaks playback. Key by action+path.
  maxRequests: 6000,
  keyPrefix: "mtx-auth",
  keyGenerator: (req) => `${req.ip || req.socket.remoteAddress || "unknown"}:${req.body?.action || ""}:${req.body?.path || ""}`,
});

/**
 * MediaMTX External HTTP Authentication Hook (Spec §6.4, §9.6, Gate G3.9).
 * MediaMTX documentation specifies:
 * Return 200/204 to accept request; return 401 to reject request.
 */
internalRouter.post("/mediamtx/auth", authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { user, password, path: streamPath, action, query } = req.body || {};
  const internalSecret = getInternalAuthSecret();

  if (!internalSecret) {
    // Misconfiguration must fail closed, but never as a 500 (MediaMTX logs that
    // as an authentication protocol error and retries forever).
    res.status(403).json({ error: "MediaMTX authentication is not configured" });
    return;
  }

  if (!isAllowedMediaMtxAction(action)) {
    res.status(400).json({ error: "Invalid MediaMTX action" });
    return;
  }
  // MediaMTX API/metrics/pprof actions have an empty path. Only stream
  // actions require a camera path.
  const streamAction = ["read", "playback", "publish"].includes(action);
  if (streamAction && !isValidStreamPath(streamPath)) {
    res.status(400).json({ error: "Invalid MediaMTX path" });
    return;
  }

  // 1. Internal readers/publishers (recorder + AI worker) present the service secret.
  if (safeSecretCompare(password, internalSecret)) {
    res.status(200).json({ ok: true });
    return;
  }

  // Browser/API users may only read/play back. Publishing is an admin-only operation.
  if (!isReadOnlyMediaMtxAction(action)) {
    res.status(403).json({ error: "Publish requires admin or the internal service secret" });
    return;
  }

  // 2. Extract token from query parameter ?jwt=... or ?token=... or password field
  let tokenCandidate: string | null = null;
  if (query && typeof query === "string") {
    const params = new URLSearchParams(query);
    tokenCandidate = params.get("jwt") || params.get("token") || params.get("access_token");
  }
  if (!tokenCandidate && password && password.startsWith("ey")) {
    // JWT formatted string in password field
    tokenCandidate = password;
  }

  if (tokenCandidate) {
    try {
      await verifyAccessToken(tokenCandidate);
      res.status(200).json({ ok: true });
      return;
    } catch {
      res.status(401).json({ error: "Invalid access token" });
      return;
    }
  }

  // 3. Basic auth check against database users table
  if (user && password) {
    try {
      const pool = getDbPool();
      const [rows] = await pool.query<any[]>(
        "SELECT password_hash FROM users WHERE username = ? LIMIT 1",
        [user]
      );

      if (rows.length > 0) {
        const valid = await verifyPassword(rows[0].password_hash, password);
        if (valid) {
          res.status(200).json({ ok: true });
          return;
        }
      }
    } catch {
      // DB error -> reject
    }
  }

  // Gate G3.9: Unauthenticated read or invalid credentials rejected with 401
  res.status(401).json({ error: "Authentication required for stream access" });
});

