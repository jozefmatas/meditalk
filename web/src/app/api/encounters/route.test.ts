// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabase,
  makeJsonRequest,
  makeGetRequest,
} from "@/test/route-helpers";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSupabase = createMockSupabase();

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    userId: "user-123",
    supabase: mockSupabase,
    user: { email: "test@example.com" },
  }),
}));

vi.mock("@/lib/encounters/normalize-status", () => ({
  normalizeStatus: vi.fn((s: string) => s),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  createAuditContext: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { GET, POST } = await import("./route");

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/encounters", () => {
  it("returns paginated encounters", async () => {
    const visits = [{ id: "v1", status: "started" }];
    // The chained query eventually resolves with data + count
    mockSupabase.range.mockResolvedValueOnce({
      data: visits,
      error: null,
      count: 1,
    });

    const res = await GET(makeGetRequest("/api/encounters"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.encounters).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("caps limit at 50", async () => {
    mockSupabase.range.mockResolvedValueOnce({
      data: [],
      error: null,
      count: 0,
    });

    await GET(makeGetRequest("/api/encounters", { limit: "999" }));
    // range should be called with offset=0, end=49 (limit capped to 50)
    expect(mockSupabase.range).toHaveBeenCalledWith(0, 49);
  });

  it("filters by comma-separated status", async () => {
    mockSupabase.range.mockResolvedValueOnce({
      data: [],
      error: null,
      count: 0,
    });

    await GET(
      makeGetRequest("/api/encounters", { status: "to_review,completed" }),
    );
    expect(mockSupabase.in).toHaveBeenCalledWith("status", [
      "to_review",
      "completed",
    ]);
  });

  it("returns 500 on query error", async () => {
    mockSupabase.range.mockResolvedValueOnce({
      data: null,
      error: { message: "db error" },
      count: null,
    });

    const res = await GET(makeGetRequest("/api/encounters"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/encounters", () => {
  it("creates an encounter with defaults", async () => {
    const created = { id: "v-new", status: "started", language: "sk" };
    mockSupabase.single.mockResolvedValueOnce({ data: created, error: null });

    const res = await POST(makeJsonRequest("/api/encounters", {}));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("v-new");
  });

  it("passes provided fields to insert", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: "v-new" },
      error: null,
    });

    await POST(
      makeJsonRequest("/api/encounters", {
        title: "My Visit",
        language: "en",
        visit_type: "follow_up",
      }),
    );

    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "My Visit",
        language: "en",
        visit_type: "follow_up",
      }),
    );
  });

  it("returns 500 on insert error", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "insert failed" },
    });

    const res = await POST(makeJsonRequest("/api/encounters", {}));
    expect(res.status).toBe(500);
  });
});
