// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    userId: "user-123",
    supabase: mockSupabase,
    user: { email: "test@example.com" },
  }),
}));

vi.mock("@/lib/templates", () => ({
  DEFAULT_TEMPLATE_ID: "default-template",
  buildSectionLabelsFromTemplate: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/templates/server", () => ({
  resolveTemplate: vi.fn().mockResolvedValue({
    id: "default-template",
    sections: [],
  }),
}));

vi.mock("@/lib/sections/adjust-router", () => ({
  routeAdjustment: vi.fn().mockResolvedValue({
    affectedSectionIds: ["la"],
    reasoning: "medication change",
  }),
}));

vi.mock("@/lib/pipeline", () => ({
  createPipelineStream: vi.fn(),
}));

vi.mock("@/lib/pipeline/adjust-helpers", () => ({
  collectLeafSectionsForRouter: vi.fn().mockReturnValue([]),
  expandVitalGroup: vi.fn().mockImplementation((set) => set),
}));

vi.mock("@/lib/sections/note-skeleton", () => ({
  extractSkeleton: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  createAuditContext: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/encounters/sources", () => ({
  getTranscript: vi.fn().mockReturnValue("existing transcript"),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { requireAuth } = await import("@/lib/supabase/auth");
const { createPipelineStream } = await import("@/lib/pipeline");
const { POST } = await import("./route");

const mockRequireAuth = vi.mocked(requireAuth);
const mockCreatePipelineStream = vi.mocked(createPipelineStream);

// ── Helpers ───────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/adjust", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const defaultVisit = {
  id: "v1",
  language: "sk",
  metadata: {
    section_contents: { la: "Ibuprofen" },
    transcript: "original transcript",
  },
  encounter_note: "<p>Prior note</p>",
};

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.single.mockResolvedValue({
    data: defaultVisit,
    error: null,
  });
});

describe("POST /api/adjust", () => {
  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error("no auth"));

    const res = await POST(makeRequest({ visitId: "v1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when visitId is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when no adjustmentTranscript and no newFileIds", async () => {
    const res = await POST(makeRequest({ visitId: "v1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Nothing to adjust");
  });

  it("returns 404 when visit not found", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });

    const res = await POST(
      makeRequest({
        visitId: "v1",
        adjustmentTranscript: "add amoxicillin",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("calls createPipelineStream with leafIdFilter and priorSectionContents", async () => {
    const mockResponse = new Response("ok");
    mockCreatePipelineStream.mockReturnValue(mockResponse);

    const res = await POST(
      makeRequest({
        visitId: "v1",
        adjustmentTranscript: "add amoxicillin",
      }),
    );

    expect(mockCreatePipelineStream).toHaveBeenCalledOnce();
    const call = mockCreatePipelineStream.mock.calls[0][0];
    expect(call.sessionInput.leafIdFilter).toBeDefined();
    expect(call.sessionInput.priorSectionContents).toEqual({
      la: "Ibuprofen",
    });
    expect(call.label).toBe("adjust");
    expect(res).toBe(mockResponse);
  });

  it("merges adjustment transcript with existing transcript", async () => {
    const mockResponse = new Response("ok");
    mockCreatePipelineStream.mockReturnValue(mockResponse);

    await POST(
      makeRequest({
        visitId: "v1",
        adjustmentTranscript: "patient reports headache",
      }),
    );

    const call = mockCreatePipelineStream.mock.calls[0][0];
    expect(call.sessionInput.rawSource.transcript).toContain(
      "existing transcript",
    );
    expect(call.sessionInput.rawSource.transcript).toContain(
      "patient reports headache",
    );
  });

  it("includes merged transcript in persist metadata", async () => {
    const mockResponse = new Response("ok");
    mockCreatePipelineStream.mockReturnValue(mockResponse);

    await POST(
      makeRequest({
        visitId: "v1",
        adjustmentTranscript: "add note",
      }),
    );

    const call = mockCreatePipelineStream.mock.calls[0][0];
    expect(call.persist.metadataPartial).toHaveProperty("transcript");
  });

  it("does not set completeEventExtras or afterPersist", async () => {
    const mockResponse = new Response("ok");
    mockCreatePipelineStream.mockReturnValue(mockResponse);

    await POST(
      makeRequest({
        visitId: "v1",
        adjustmentTranscript: "adjust",
      }),
    );

    const call = mockCreatePipelineStream.mock.calls[0][0];
    expect(call.completeEventExtras).toBeUndefined();
    expect(call.afterPersist).toBeUndefined();
  });
});
