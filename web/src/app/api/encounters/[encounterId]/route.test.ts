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

vi.mock("@/lib/supabase/merge-metadata", () => ({
  mergeVisitMetadata: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  createAuditContext: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { requireAuth } = await import("@/lib/supabase/auth");
const { mergeVisitMetadata } = await import("@/lib/supabase/merge-metadata");
const { GET, PATCH, DELETE } = await import("./route");

const mockRequireAuth = vi.mocked(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────

const defaultVisit = {
  id: "v1",
  user_id: "user-123",
  title: "Test visit",
  status: "started",
  language: "sk",
  metadata: {},
};

function routeParams(encounterId = "v1") {
  return { params: Promise.resolve({ encounterId }) };
}

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.single.mockResolvedValue({ data: defaultVisit, error: null });
});

describe("GET /api/encounters/[encounterId]", () => {
  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );
    const res = await GET(makeGetRequest("/api/encounters/v1"), routeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when visit not found", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });
    const res = await GET(makeGetRequest("/api/encounters/v1"), routeParams());
    expect(res.status).toBe(404);
  });

  it("returns visit with normalized status", async () => {
    const res = await GET(makeGetRequest("/api/encounters/v1"), routeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("v1");
  });
});

describe("PATCH /api/encounters/[encounterId]", () => {
  it("returns 400 when no fields provided", async () => {
    const req = makeJsonRequest("/api/encounters/v1", {}, "PATCH");
    const res = await PATCH(req, routeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No fields");
  });

  it("updates column fields", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: { ...defaultVisit, title: "Updated" },
      error: null,
    });

    const req = makeJsonRequest(
      "/api/encounters/v1",
      { title: "Updated" },
      "PATCH",
    );
    const res = await PATCH(req, routeParams());
    expect(res.status).toBe(200);
    expect(mockSupabase.update).toHaveBeenCalledWith({ title: "Updated" });
  });

  it("merges metadata via RPC", async () => {
    // metadata-only update returns the visit on the second single() call
    mockSupabase.single.mockResolvedValueOnce({
      data: defaultVisit,
      error: null,
    });

    const req = makeJsonRequest(
      "/api/encounters/v1",
      { metadata: { foo: "bar" } },
      "PATCH",
    );
    const res = await PATCH(req, routeParams());
    expect(res.status).toBe(200);
    expect(mergeVisitMetadata).toHaveBeenCalledWith(mockSupabase, "v1", {
      foo: "bar",
    });
  });

  it("handles combined column + metadata update", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: { ...defaultVisit, title: "New" },
      error: null,
    });

    const req = makeJsonRequest(
      "/api/encounters/v1",
      { title: "New", metadata: { key: "val" } },
      "PATCH",
    );
    const res = await PATCH(req, routeParams());
    expect(res.status).toBe(200);
    expect(mergeVisitMetadata).toHaveBeenCalled();
    expect(mockSupabase.update).toHaveBeenCalledWith({ title: "New" });
  });

  it("returns 500 on update error", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "db error" },
    });

    const req = makeJsonRequest("/api/encounters/v1", { title: "X" }, "PATCH");
    const res = await PATCH(req, routeParams());
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/encounters/[encounterId]", () => {
  it("soft-deletes (archives) by default", async () => {
    const req = makeGetRequest("/api/encounters/v1");
    const res = await DELETE(
      new (await import("next/server")).NextRequest(req.url, {
        method: "DELETE",
      }),
      routeParams(),
    );
    expect(res.status).toBe(200);
    expect(mockSupabase.update).toHaveBeenCalledWith({ status: "archived" });
  });

  it("hard-deletes with ?hard=true and cleans up storage", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: {
        audio_path: "user-123/audio.m4a",
        metadata: { files: [{ path: "user-123/v1/file.pdf" }] },
      },
      error: null,
    });

    const req = new (await import("next/server")).NextRequest(
      "http://localhost:3000/api/encounters/v1?hard=true",
      { method: "DELETE" },
    );
    const res = await DELETE(req, routeParams());
    expect(res.status).toBe(200);

    // storage.from() always returns the same mock, so check by argument
    expect(mockSupabase.storage.from).toHaveBeenCalledWith("audio");
    expect(mockSupabase.storage.from).toHaveBeenCalledWith("encounter-files");
  });

  it("returns 500 on db delete error", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: { audio_path: null, metadata: {} },
      error: null,
    });
    // Chain: fetch does .eq().eq().single(), delete does .eq().eq()
    // Skip first 3 .eq() calls (2 from fetch + 1 from delete), error on 4th
    mockSupabase.eq
      .mockReturnValueOnce(mockSupabase) // fetch .eq("id")
      .mockReturnValueOnce(mockSupabase) // fetch .eq("user_id")
      .mockReturnValueOnce(mockSupabase) // delete .eq("id")
      .mockResolvedValueOnce({ error: { message: "db error" } }); // delete .eq("user_id")

    const req = new (await import("next/server")).NextRequest(
      "http://localhost:3000/api/encounters/v1?hard=true",
      { method: "DELETE" },
    );
    const res = await DELETE(req, routeParams());
    expect(res.status).toBe(500);
  });
});
