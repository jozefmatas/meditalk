import { describe, it, expect } from "vitest";
import {
  isTransientStatusCode,
  isTransientNetworkError,
} from "./is-transient-error";

// ── isTransientStatusCode ──────────────────────────────────────────

describe("isTransientStatusCode", () => {
  it("returns true for 502 Bad Gateway", () => {
    expect(isTransientStatusCode(502)).toBe(true);
  });

  it.each([408, 429, 503, 504])("returns true for %i", (code) => {
    expect(isTransientStatusCode(code)).toBe(true);
  });

  it.each([200, 400, 401, 403, 404, 500])("returns false for %i", (code) => {
    expect(isTransientStatusCode(code)).toBe(false);
  });
});

// ── isTransientNetworkError ────────────────────────────────────────

describe("isTransientNetworkError", () => {
  it("returns true for TypeError (fetch network failure)", () => {
    expect(isTransientNetworkError(new TypeError("fetch failed"))).toBe(true);
  });

  it("returns true for TypeError with no message", () => {
    expect(isTransientNetworkError(new TypeError())).toBe(true);
  });

  it.each([
    "fetch failed",
    "ECONNRESET",
    "socket hang up",
    "UND_ERR_SOCKET",
    "other side closed",
    "network error",
    "terminated",
    "ETIMEDOUT",
    "aborted",
    "Failed to fetch",
  ])("returns true for Error with message containing '%s'", (msg) => {
    expect(isTransientNetworkError(new Error(msg))).toBe(true);
  });

  it("inspects err.cause.message for transient patterns", () => {
    const err = new Error("outer");
    err.cause = new Error("connect ECONNRESET 1.2.3.4:443");
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("inspects non-Error cause via String()", () => {
    const err = new Error("outer");
    err.cause = "socket hang up";
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("returns false for non-Error values", () => {
    expect(isTransientNetworkError("fetch failed")).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
    expect(isTransientNetworkError(42)).toBe(false);
  });

  it("returns false for a regular application error", () => {
    expect(isTransientNetworkError(new Error("invalid json"))).toBe(false);
  });

  it("returns false for Error with unrelated cause", () => {
    const err = new Error("outer");
    err.cause = new Error("constraint violation");
    expect(isTransientNetworkError(err)).toBe(false);
  });
});
