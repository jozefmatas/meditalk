// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  storage: {
    from: vi.fn().mockReturnValue({
      remove: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
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
}));

vi.mock("@/lib/templates/server", () => ({
  resolveTemplate: vi.fn().mockResolvedValue({
    id: "default-template",
    sections: [],
  }),
}));

vi.mock("@/lib/pipeline", () => ({
  resolveSource: vi.fn(),
  createPipelineStream: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  createAuditContext: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/email/send-note-email", () => ({
  dispatchNoteEmail: vi.fn(),
}));

vi.mock("@/lib/encounters/sources", () => ({
  getTranscript: vi.fn(),
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
const { resolveSource, createPipelineStream } = await import("@/lib/pipeline");
const { getTranscript } = await import("@/lib/encounters/sources");
const { POST } = await import("./route");

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveSource = vi.mocked(resolveSource);
const mockCreatePipelineStream = vi.mocked(createPipelineStream);
const mockGetTranscript = vi.mocked(getTranscript);

// ── Helpers ───────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/generate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const defaultVisit = {
  id: "v1",
  title: "Test visit",
  language: "sk",
  metadata: {},
  visit_date: "2024-01-01",
  patient_name: "Test Patient",
  patient_id: null,
};

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.single.mockResolvedValue({
    data: defaultVisit,
    error: null,
  });
  mockGetTranscript.mockReturnValue(null);
});

describe("POST /api/generate", () => {
  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error("no auth"));

    const res = await POST(makeRequest({ visitId: "v1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when visitId is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing");
  });

  it("returns 404 when visit not found", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });

    const res = await POST(makeRequest({ visitId: "v1" }));
    expect(res.status).toBe(404);
  });

  it("returns 422 when no content (cached mode, empty metadata)", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: { ...defaultVisit, metadata: {} },
      error: null,
    });
    mockGetTranscript.mockReturnValue(null);

    const res = await POST(makeRequest({ visitId: "v1" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("insufficient_context");
  });

  it("calls resolveSource in fresh mode (with transcriptText)", async () => {
    const mockResponse = new Response("ok");
    mockCreatePipelineStream.mockReturnValue(mockResponse);
    mockResolveSource.mockResolvedValue({
      rawSource: { transcript: "hello doctor" },
      transcriptText: "hello doctor",
      doctorNotes: undefined,
      fileTexts: [],
      phiRedactionCount: 0,
      refreshedMetadata: {},
    });

    const res = await POST(
      makeRequest({
        visitId: "v1",
        transcriptText: "hello doctor",
      }),
    );

    expect(mockResolveSource).toHaveBeenCalledOnce();
    expect(mockCreatePipelineStream).toHaveBeenCalledOnce();
    expect(res).toBe(mockResponse);
  });

  it("uses cached mode when no transcriptText/audioPath", async () => {
    const mockResponse = new Response("ok");
    mockCreatePipelineStream.mockReturnValue(mockResponse);
    mockGetTranscript.mockReturnValue("cached transcript");

    const res = await POST(makeRequest({ visitId: "v1" }));

    expect(mockResolveSource).not.toHaveBeenCalled();
    expect(mockCreatePipelineStream).toHaveBeenCalledOnce();
    expect(res).toBe(mockResponse);
  });

  it("passes clinicalAnalysis extras in completeEventExtras", async () => {
    const mockResponse = new Response("ok");
    mockCreatePipelineStream.mockReturnValue(mockResponse);
    mockGetTranscript.mockReturnValue("cached transcript");

    await POST(makeRequest({ visitId: "v1" }));

    const call = mockCreatePipelineStream.mock.calls[0][0];
    expect(call.completeEventExtras).toBeDefined();
    // Verify the extras function returns clinicalAnalysis when present
    const extras = call.completeEventExtras!({
      generatedNote: "",
      sectionContents: {},
      templateId: "t1",
      clinicalAnalysis: { suggestedIcdCodes: [] },
    });
    expect(extras).toEqual({ clinicalAnalysis: { suggestedIcdCodes: [] } });
  });

  it("passes afterPersist callback for email and audio cleanup", async () => {
    const mockResponse = new Response("ok");
    mockCreatePipelineStream.mockReturnValue(mockResponse);
    mockGetTranscript.mockReturnValue("cached transcript");

    await POST(makeRequest({ visitId: "v1", sendAsEmail: true }));

    const call = mockCreatePipelineStream.mock.calls[0][0];
    expect(call.afterPersist).toBeDefined();
    expect(call.label).toBe("generate");
  });

  it("includes doctorNotes in cached mode extraMetadata", async () => {
    const mockResponse = new Response("ok");
    mockCreatePipelineStream.mockReturnValue(mockResponse);
    mockGetTranscript.mockReturnValue("cached transcript");

    await POST(
      makeRequest({
        visitId: "v1",
        doctorNotes: "patient dizzy",
      }),
    );

    const call = mockCreatePipelineStream.mock.calls[0][0];
    expect(call.persist.metadataPartial).toEqual({
      doctor_notes: "patient dizzy",
    });
  });
});
