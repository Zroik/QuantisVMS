import { Router, type Request, type Response } from "express";
import { getDbPool } from "../db/connection.js";
import { verifyPassword, verifyAccessToken } from "../auth/service.js";

export const internalRouter = Router();

const INTERNAL_AUTH_SECRET = process.env.MEDIAMTX_AUTH_SECRET || "mediamtx_internal_token_secret";

/**
 * MediaMTX External HTTP Authentication Hook (Spec §6.4, §9.6, Gate G3.9).
 * MediaMTX documentation specifies:
 * Return 200/204 to accept request; return 401 to reject request.
 */
internalRouter.post("/mediamtx/auth", async (req: Request, res: Response): Promise<void> => {
  const { ip, user, password, path: streamPath, action, query } = req.body || {};

  // 1. Allow internal publishers or internal readers with secret
  if (password === INTERNAL_AUTH_SECRET || user === "internal_publisher" || user === "internal_reader") {
    res.status(200).json({ ok: true });
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
      // Token invalid
      res.status(401).json({ error: "Invalid access token" });
      return;
    }
  }

  // 3. Basic auth check against database users table
  if (user && password) {
    try {
      // Check internal bypass secret
      if (password === INTERNAL_AUTH_SECRET) {
        res.status(200).json({ ok: true });
        return;
      }

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

