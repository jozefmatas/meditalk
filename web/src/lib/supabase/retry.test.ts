import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env/server", () => ({
  serverEnv: { NODE_ENV: "test" },
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-key",
    NEXT_PUBLIC_APP_URL: "",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { retrySupabaseCall, isTransientFetchError } from "./retry";

describe("isTransientFetchError", () => {
  it("identifies undici TypeError: fetch failed as transient", () => {
    expect(isTransientFetchError(new TypeError("fetch failed"))).toBe(true);
  });

  it("identifies ECONNRESET as transient", () => {
    expect(isTransientFetchError(new Error("ECONNRESET"))).toBe(true);
  });

  it("identifies 'socket hang up' as transient", () => {
    expect(isTransientFetchError(new Error("socket hang up"))).toBe(true);
  });

  it("identifies UND_ERR_SOCKET as transient", () => {
    expect(
      isTransientFetchError(new Error("UND_ERR_SOCKET: other side closed")),
    ).toBe(true);
  });

  it("identifies ETIMEDOUT as transient", () => {
    expect(isTransientFetchError(new Error("connect ETIMEDOUT"))).toBe(true);
  });

  it("unwraps the cause chain for wrapped errors", () => {
    const err = new TypeError("fetch failed", {
      cause: new Error("other side closed"),
    });
    expect(isTransientFetchError(err)).toBe(true);
  });

  it("does not match application-level errors", () => {
    expect(isTransientFetchError(new Error("row not found"))).toBe(false);
    expect(isTransientFetchError(new Error("unique constraint violated"))).toBe(
      false,
    );
    expect(isTransientFetchError(new Error("permission denied"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isTransientFetchError(null)).toBe(false);
    expect(isTransientFetchError(undefined)).toBe(false);
    expect(isTransientFetchError("string")).toBe(false);
    expect(isTransientFetchError({ message: "fetch failed" })).toBe(false);
  });
});

describe("retrySupabaseCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns successful result on first attempt without retrying", async () => {
    const op = vi.fn().mockResolvedValue({ data: { id: 1 }, error: null });
    const result = await retrySupabaseCall(op, { label: "test" });
    expect(op).toHaveBeenCalledTimes(1);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: 1 });
  });

  it("retries on transient fetch error then succeeds", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ data: { id: 2 }, error: null });
    const result = await retrySupabaseCall(op, {
      label: "test",
      baseDelayMs: 1,
    });
    expect(op).toHaveBeenCalledTimes(2);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: 2 });
  });

  it("retries multiple times with backoff on repeated transient failures", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ data: { id: 3 }, error: null });
    const result = await retrySupabaseCall(op, {
      label: "test",
      baseDelayMs: 1,
    });
    expect(op).toHaveBeenCalledTimes(3);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: 3 });
  });

  it("gives up after maxAttempts on persistent transient failure", async () => {
    const op = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const result = await retrySupabaseCall(op, {
      label: "test",
      maxAttempts: 3,
      baseDelayMs: 1,
    });
    expect(op).toHaveBeenCalledTimes(3);
    expect(result.error).toBeInstanceOf(TypeError);
  });

  it("does NOT retry application-level Supabase errors in the result field", async () => {
    const op = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "row not found", code: "PGRST116" },
    });
    const result = await retrySupabaseCall(op, {
      label: "test",
      baseDelayMs: 1,
    });
    expect(op).toHaveBeenCalledTimes(1);
    expect(result.error).toEqual({
      message: "row not found",
      code: "PGRST116",
    });
  });

  it("does NOT retry non-transient thrown errors", async () => {
    const op = vi.fn().mockRejectedValue(new Error("permission denied"));
    const result = await retrySupabaseCall(op, {
      label: "test",
      baseDelayMs: 1,
    });
    expect(op).toHaveBeenCalledTimes(1);
    expect((result.error as Error).message).toBe("permission denied");
  });

  it("respects custom maxAttempts", async () => {
    const op = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await retrySupabaseCall(op, {
      label: "test",
      maxAttempts: 5,
      baseDelayMs: 1,
    });
    expect(op).toHaveBeenCalledTimes(5);
  });

  it("defaults to 3 attempts when maxAttempts not provided", async () => {
    const op = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await retrySupabaseCall(op, { label: "test", baseDelayMs: 1 });
    expect(op).toHaveBeenCalledTimes(3);
  });
});
