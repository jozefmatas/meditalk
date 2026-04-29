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
    user: { email: "doc@example.com" },
  }),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  createAuditContext: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { requireAuth } = await import("@/lib/supabase/auth");
const { POST, GET } = await import("./route");

const mockRequireAuth = vi.mocked(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────

function routeParams(encounterId = "v1") {
  return { params: Promise.resolve({ encounterId }) };
}

const defaultVisit = {
  id: "v1",
  user_id: "user-123",
  title: "Test visit",
  status: "to_review",
  language: "sk",
  metadata: {
    template_id: "t_abc123",
    section_contents: {
      oa: "<p>Patient presented with headache</p>",
      la: "<p>Ibuprofen 400mg</p>",
    },
    transcript: "Doctor: Hello. Patient: I have a headache.",
    doctor_notes: "Headache for 3 days",
  },
};

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  // resetAllMocks clears once-queues + resets impls; re-apply chainable defaults
  vi.resetAllMocks();
  for (const key of Object.keys(mockSupabase)) {
    const val = mockSupabase[key as keyof typeof mockSupabase];
    if (typeof val === "function" && "mockReturnThis" in val) {
      val.mockReturnThis();
    }
  }
  mockSupabase.single.mockResolvedValue({ data: null, error: null });
  mockSupabase.rpc.mockResolvedValue({ error: null });
  // Re-apply auth mock
  mockRequireAuth.mockResolvedValue({
    userId: "user-123",
    supabase: mockSupabase,
    user: { email: "doc@example.com" },
  } as never);
  // Visit fetch chain: from().select().eq().eq().single()
  mockSupabase.single.mockResolvedValue({ data: defaultVisit, error: null });
  // Insert chain: from().insert().select("id")
  // select() is shared — first call chains (visit), second resolves (insert).
  // Use mockReturnValueOnce for the chaining call, then mockResolvedValueOnce for insert.
  mockSupabase.select
    .mockReturnValueOnce(mockSupabase) // visit fetch: .select("metadata") → chain
    .mockResolvedValueOnce({ data: [{ id: "fb-1" }], error: null }); // insert: .select("id") → resolve
});

describe("POST /api/encounters/[encounterId]/feedback", () => {
  it("submits thumbs-down with categories and snapshots section content", async () => {
    const req = makeJsonRequest("/api/encounters/v1/feedback", {
      sectionId: "oa",
      sectionKind: "history-narrative",
      rating: "down",
      categories: ["hallucination", "missing-info"],
      detail: "Patient never said they had a fever",
    });

    const res = await POST(req, routeParams());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe("fb-1");

    // Verify insert was called with correct shape
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        visit_id: "v1",
        user_id: "user-123",
        template_id: "t_abc123",
        section_id: "oa",
        section_kind: "history-narrative",
        rating: "down",
        categories: ["hallucination", "missing-info"],
        detail: "Patient never said they had a fever",
        section_content: "<p>Patient presented with headache</p>",
        source_snapshot: expect.objectContaining({
          transcript: expect.any(String),
          doctor_notes: expect.any(String),
        }),
      }),
    );
  });

  it("submits global thumbs-up with no categories or detail", async () => {
    mockSupabase.select
      .mockReturnValueOnce(mockSupabase)
      .mockResolvedValueOnce({ data: [{ id: "fb-2" }], error: null });

    const req = makeJsonRequest("/api/encounters/v1/feedback", {
      rating: "up",
    });

    const res = await POST(req, routeParams());
    expect(res.status).toBe(200);

    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        section_id: null,
        section_kind: null,
        rating: "up",
        categories: [],
        detail: "",
        section_content: null,
      }),
    );
  });

  it("resets clean_streak on existing active entries for repeat thumbs-down", async () => {
    mockSupabase.select
      .mockReturnValueOnce(mockSupabase)
      .mockResolvedValueOnce({ data: [{ id: "fb-3" }], error: null });

    const req = makeJsonRequest("/api/encounters/v1/feedback", {
      sectionId: "oa",
      rating: "down",
      categories: ["hallucination"],
      detail: "Still hallucinating",
    });

    const res = await POST(req, routeParams());
    expect(res.status).toBe(200);

    // Should have called update to reset streaks before insert
    expect(mockSupabase.update).toHaveBeenCalledWith({ clean_streak: 0 });
    // Update should target section_feedback table
    expect(mockSupabase.from).toHaveBeenCalledWith("section_feedback");
  });

  it("returns 404 when encounter not found", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });

    const req = makeJsonRequest("/api/encounters/v1/feedback", {
      rating: "down",
      categories: ["hallucination"],
    });

    const res = await POST(req, routeParams());
    expect(res.status).toBe(404);
  });

  it("returns 400 when rating is missing", async () => {
    const req = makeJsonRequest("/api/encounters/v1/feedback", {
      sectionId: "oa",
    });

    const res = await POST(req, routeParams());
    expect(res.status).toBe(400);
  });

  it("returns 400 when rating is invalid", async () => {
    const req = makeJsonRequest("/api/encounters/v1/feedback", {
      rating: "meh",
    });

    const res = await POST(req, routeParams());
    expect(res.status).toBe(400);
  });
});

describe("GET /api/encounters/[encounterId]/feedback", () => {
  it("returns feedback entries for the encounter", async () => {
    const feedbackRows = [
      {
        id: "fb-1",
        section_id: "oa",
        rating: "down",
        categories: ["hallucination"],
        detail: "Wrong info",
        created_at: "2026-04-29T12:00:00Z",
      },
      {
        id: "fb-2",
        section_id: null,
        rating: "up",
        categories: [],
        detail: "",
        created_at: "2026-04-29T12:05:00Z",
      },
    ];

    // GET chain: from().select().eq().eq() — first .eq chains, second resolves
    mockSupabase.eq
      .mockReturnValueOnce(mockSupabase) // .eq("visit_id") → chain
      .mockResolvedValueOnce({ data: feedbackRows, error: null }); // .eq("user_id") → resolve

    const req = makeGetRequest("/api/encounters/v1/feedback");
    const res = await GET(req, routeParams());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.feedback).toHaveLength(2);
    expect(body.feedback[0].id).toBe("fb-1");
    expect(body.feedback[1].rating).toBe("up");
  });

  it("returns empty array when no feedback exists", async () => {
    mockSupabase.eq
      .mockReturnValueOnce(mockSupabase)
      .mockResolvedValueOnce({ data: [], error: null });

    const req = makeGetRequest("/api/encounters/v1/feedback");
    const res = await GET(req, routeParams());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.feedback).toEqual([]);
  });

  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    const req = makeGetRequest("/api/encounters/v1/feedback");
    const res = await GET(req, routeParams());
    expect(res.status).toBe(401);
  });
});
