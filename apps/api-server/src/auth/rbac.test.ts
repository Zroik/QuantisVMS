import { describe, it, expect, vi } from "vitest";
import { requireRole, authenticateToken, authenticateMediaToken } from "./middleware.js";
import { generateTokens } from "./service.js";
import type { Request, Response, NextFunction } from "express";

describe("RBAC & Auth Middleware (Spec §5.2, B-C4, B-H3)", () => {
  it("rejects unauthenticated request with 401", () => {
    const middleware = requireRole("admin");
    const req = { user: undefined } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentication required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects viewer user when admin role is required with 403 Forbidden", () => {
    const middleware = requireRole("admin");
    const req = {
      user: { userId: 2, username: "viewer_user", role: "viewer" },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Admin role required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows admin user when admin role is required", () => {
    const middleware = requireRole("admin");
    const req = {
      user: { userId: 1, username: "admin_user", role: "admin" },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows viewer user when viewer role is required", () => {
    const middleware = requireRole("viewer");
    const req = {
      user: { userId: 2, username: "viewer_user", role: "viewer" },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("authenticateToken disallows token in query parameter (prevents token leakage in logs/Referer)", async () => {
    const req = {
      headers: {},
      query: { token: "some-jwt-token" },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing authentication token" });
    expect(next).not.toHaveBeenCalled();
  });

  it("authenticateMediaToken allows token in query parameter for video player", async () => {
    const tokens = await generateTokens({ userId: 3, username: "stream_user", role: "viewer" });
    const req = {
      headers: {},
      query: { token: tokens.accessToken },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await authenticateMediaToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user?.username).toBe("stream_user");
  });
});

