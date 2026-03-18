import { describe, it, expect, vi, beforeEach } from "vitest";
import { isAdminEmail, IMPERSONATE_COOKIE } from "./admin";

describe("isAdminEmail", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false for null/undefined", () => {
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAdminEmail("")).toBe(false);
  });

  it("returns false when ADMIN_EMAILS is not set", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(isAdminEmail("user@example.com")).toBe(false);
  });

  it("returns true for matching email", () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    expect(isAdminEmail("admin@example.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    vi.stubEnv("ADMIN_EMAILS", "Admin@Example.com");
    expect(isAdminEmail("admin@example.com")).toBe(true);
    expect(isAdminEmail("ADMIN@EXAMPLE.COM")).toBe(true);
  });

  it("handles comma-separated list", () => {
    vi.stubEnv("ADMIN_EMAILS", "one@test.com, two@test.com, three@test.com");
    expect(isAdminEmail("two@test.com")).toBe(true);
    expect(isAdminEmail("four@test.com")).toBe(false);
  });

  it("trims whitespace around emails", () => {
    vi.stubEnv("ADMIN_EMAILS", "  spaced@test.com  ,  other@test.com  ");
    expect(isAdminEmail("spaced@test.com")).toBe(true);
    expect(isAdminEmail("other@test.com")).toBe(true);
  });

  it("ignores empty entries from extra commas", () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@test.com,,,,");
    expect(isAdminEmail("admin@test.com")).toBe(true);
  });
});

describe("IMPERSONATE_COOKIE", () => {
  it("is a non-empty string", () => {
    expect(IMPERSONATE_COOKIE).toBeTruthy();
    expect(typeof IMPERSONATE_COOKIE).toBe("string");
  });
});
