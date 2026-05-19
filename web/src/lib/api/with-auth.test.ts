// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────

const mockRequireAuth = vi.fn();
vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

const mockLoggerError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

// Import after mocks
const { withAuth } = await import("./with-auth");

// ── Helpers ───────────────────────────────────────────────────────

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/test");
}

const fakeAuth = {
  userId: "user-1",
  supabase: { mock: true },
  isImpersonating: false,
  realUserId: "user-1",
  realUserEmail: "user@example.com",
};

// ── Tests ─────────────────────────────────────────────────────────

describe("withAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(fakeAuth);
  });

  it("calls the handler with request and auth on success", async () => {
    const handler = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    const route = withAuth(handler);

    const res = await route(makeRequest());

    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0][0];
    expect(ctx.auth).toEqual(fakeAuth);
    expect(ctx.request).toBeInstanceOf(NextRequest);
    expect(res.status).toBe(200);
  });

  it("returns 401 Response when requireAuth throws Response (auth failure)", async () => {
    const unauthorized = new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
      },
    );
    mockRequireAuth.mockRejectedValueOnce(unauthorized);
    const handler = vi.fn();
    const route = withAuth(handler);

    const res = await route(makeRequest());

    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it("returns the handler's thrown Response unchanged (e.g. 404)", async () => {
    const notFound = new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
    });
    const handler = vi.fn().mockRejectedValue(notFound);
    const route = withAuth(handler);

    const res = await route(makeRequest());

    expect(res.status).toBe(404);
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("returns 500 and logs when handler throws plain Error", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const route = withAuth(handler, { logPrefix: "test-route" });

    const res = await route(makeRequest());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Internal server error" });
    expect(mockLoggerError).toHaveBeenCalled();
    const logArgs = mockLoggerError.mock.calls[0];
    expect(String(logArgs[0])).toContain("test-route");
  });

  it("awaits params before passing to handler", async () => {
    interface Params {
      id: string;
    }
    const handler = vi.fn(async (ctx: { params: Params }) => {
      return new Response(JSON.stringify({ id: ctx.params.id }), {
        status: 200,
      });
    });
    const route = withAuth<Params>(handler);

    const res = await route(makeRequest(), {
      params: Promise.resolve({ id: "abc-123" }),
    });

    expect(handler.mock.calls[0][0].params).toEqual({ id: "abc-123" });
    const body = await res.json();
    expect(body).toEqual({ id: "abc-123" });
  });

  it("passes an empty params object when route has no params", async () => {
    const handler = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const route = withAuth(handler);

    await route(makeRequest());

    expect(handler.mock.calls[0][0].params).toEqual({});
  });

  it("does not log when handler succeeds", async () => {
    const handler = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const route = withAuth(handler);

    await route(makeRequest());

    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});
