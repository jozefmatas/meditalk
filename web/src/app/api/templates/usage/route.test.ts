// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase, makeJsonRequest } from "@/test/route-helpers";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSupabase = createMockSupabase();

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    userId: "user-123",
    supabase: mockSupabase,
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { GET, POST } = await import("./route");

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/templates/usage", () => {
  it("returns usage map", async () => {
    mockSupabase.eq.mockResolvedValueOnce({
      data: [
        { template_id: "t1", usage_count: 5 },
        { template_id: "t2", usage_count: 2 },
      ],
      error: null,
    });

    const res = await GET(
      new NextRequest("http://localhost/api/templates/usage"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ t1: 5, t2: 2 });
  });

  it("returns 500 on db error", async () => {
    mockSupabase.eq.mockResolvedValueOnce({
      data: null,
      error: { message: "db error" },
    });

    const res = await GET(
      new NextRequest("http://localhost/api/templates/usage"),
    );
    expect(res.status).toBe(500);
  });
});

describe("POST /api/templates/usage", () => {
  it("increments usage via RPC", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ error: null });

    const res = await POST(
      makeJsonRequest("/api/templates/usage", { templateId: "t1" }),
    );
    expect(res.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith("increment_template_usage", {
      p_user_id: "user-123",
      p_template_id: "t1",
    });
  });

  it("returns 400 when templateId is missing", async () => {
    const res = await POST(makeJsonRequest("/api/templates/usage", {}));
    expect(res.status).toBe(400);
  });

  it("returns 500 on RPC error", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      error: { message: "rpc failed" },
    });

    const res = await POST(
      makeJsonRequest("/api/templates/usage", { templateId: "t1" }),
    );
    expect(res.status).toBe(500);
  });
});
