import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from "@/lib/supabase/auth";
import { withAuth } from "./with-auth";

const mockAuth = requireAuth as ReturnType<typeof vi.fn>;

function fakeAuth(
  overrides?: Partial<Awaited<ReturnType<typeof requireAuth>>>,
) {
  return {
    userId: "user-1",
    supabase: {} as never,
    isImpersonating: false,
    realUserId: "user-1",
    realUserEmail: "test@example.com",
    ...overrides,
  };
}

describe("withAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns handler response when auth succeeds", async () => {
    mockAuth.mockResolvedValue(fakeAuth());

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);
    const request = new NextRequest("http://localhost/api/test");

    const response = await wrapped(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns the 401 Response thrown by requireAuth", async () => {
    const authResponse = new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
    mockAuth.mockRejectedValue(authResponse);

    const handler = vi.fn();
    const wrapped = withAuth(handler);
    const request = new NextRequest("http://localhost/api/test");

    const response = await wrapped(request);

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 JSON when requireAuth throws a non-Response error", async () => {
    mockAuth.mockRejectedValue(new Error("cookie jar exploded"));

    const handler = vi.fn();
    const wrapped = withAuth(handler);
    const request = new NextRequest("http://localhost/api/test");

    const response = await wrapped(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 500 JSON when handler throws a non-Response error", async () => {
    mockAuth.mockResolvedValue(fakeAuth());

    const handler = vi.fn().mockRejectedValue(new Error("db down"));
    const wrapped = withAuth(handler);
    const request = new NextRequest("http://localhost/api/test");

    const response = await wrapped(request);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });

  it("returns thrown Response from handler as-is", async () => {
    mockAuth.mockResolvedValue(fakeAuth());

    const thrown = new Response("redirect", { status: 302 });
    const handler = vi.fn().mockRejectedValue(thrown);
    const wrapped = withAuth(handler);
    const request = new NextRequest("http://localhost/api/test");

    const response = await wrapped(request);

    expect(response).toBe(thrown);
  });

  it("passes auth result and request to handler", async () => {
    const auth = fakeAuth({ userId: "user-42" });
    mockAuth.mockResolvedValue(auth);

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);
    const request = new NextRequest("http://localhost/api/test");

    await wrapped(request);

    expect(handler).toHaveBeenCalledWith(auth, request);
  });

  it("passes extra route args through to handler", async () => {
    mockAuth.mockResolvedValue(fakeAuth());

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);
    const request = new NextRequest("http://localhost/api/test");
    const routeCtx = { params: Promise.resolve({ encounterId: "enc-1" }) };

    await wrapped(request, routeCtx);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      request,
      routeCtx,
    );
  });
});
