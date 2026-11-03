import { describe, it, expect, afterEach } from "vitest";
import { isAllowedMediaMtxAction, isReadOnlyMediaMtxAction, isValidStreamPath } from "./internal.js";
import { getMediaMtxAuthHeader } from "../mediamtx/client.js";

describe("MediaMTX auth hook validation (BE-S1/OPS-1)", () => {
  const originalSecret = process.env.MEDIAMTX_AUTH_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.MEDIAMTX_AUTH_SECRET;
    else process.env.MEDIAMTX_AUTH_SECRET = originalSecret;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("accepts only known MediaMTX actions", () => {
    expect(isAllowedMediaMtxAction("read")).toBe(true);
    expect(isAllowedMediaMtxAction("publish")).toBe(true);
    expect(isAllowedMediaMtxAction("playback")).toBe(true);
    expect(isAllowedMediaMtxAction("delete-everything")).toBe(false);
    expect(isAllowedMediaMtxAction(undefined)).toBe(false);
  });

  it("allows only read/playback for non-internal users", () => {
    expect(isReadOnlyMediaMtxAction("read")).toBe(true);
    expect(isReadOnlyMediaMtxAction("playback")).toBe(true);
    expect(isReadOnlyMediaMtxAction("publish")).toBe(false);
  });

  it("rejects malformed stream paths", () => {
    expect(isValidStreamPath("cam1")).toBe(true);
    expect(isValidStreamPath("cam-10")).toBe(true);
    expect(isValidStreamPath("../etc/passwd")).toBe(false);
    expect(isValidStreamPath("")).toBe(false);
    expect(isValidStreamPath(42)).toBe(false);
  });

  it("does not throw when the MediaMTX secret is missing", () => {
    delete process.env.MEDIAMTX_AUTH_SECRET;
    process.env.NODE_ENV = "production";
    expect(getMediaMtxAuthHeader()).toBeNull();
  });

  it("builds a Basic header when the secret is present", () => {
    process.env.MEDIAMTX_AUTH_SECRET = "test-secret";
    expect(getMediaMtxAuthHeader()).toBe(
      "Basic " + Buffer.from("internal_reader:test-secret").toString("base64")
    );
  });
});
