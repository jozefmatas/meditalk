// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeJsonRequest } from "@/test/route-helpers";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSupabase = createMockSupabase();

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    userId: "user-123",
    supabase: mockSupabase,
  }),
}));

const mockExtractFileText = vi.fn();
vi.mock("@/lib/extraction/extract-file", () => ({
  extractFileText: mockExtractFileText,
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { requireAuth } = await import("@/lib/supabase/auth");
const { POST } = await import("./route");

const mockRequireAuth = vi.mocked(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────

function routeParams(encounterId = "v1") {
  return { params: Promise.resolve({ encounterId }) };
}

const defaultVisit = {
  id: "v1",
  language: "sk",
  metadata: {
    files: [
      {
        id: "f1",
        name: "report.pdf",
        type: "application/pdf",
        path: "user-123/v1/report.pdf",
        extraction_status: "pending",
      },
    ],
  },
};

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.single.mockResolvedValue({ data: defaultVisit, error: null });
  mockExtractFileText.mockResolvedValue({
    text: "extracted content",
    elapsedMs: 100,
  });
  mockSupabase.rpc.mockResolvedValue({ error: null });
});

describe("POST /api/encounters/[encounterId]/extract", () => {
  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );
    const req = makeJsonRequest("/api/encounters/v1/extract", { fileId: "f1" });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(401);
  });

  it("returns 400 when fileId is missing", async () => {
    const req = makeJsonRequest("/api/encounters/v1/extract", {});
    const res = await POST(req, routeParams());
    expect(res.status).toBe(400);
  });

  it("returns 404 when visit not found", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });
    const req = makeJsonRequest("/api/encounters/v1/extract", { fileId: "f1" });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(404);
  });

  it("returns 404 when file not found in metadata", async () => {
    const req = makeJsonRequest("/api/encounters/v1/extract", {
      fileId: "unknown",
    });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(404);
  });

  it("returns cached result when already extracted", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: {
        ...defaultVisit,
        metadata: {
          files: [
            {
              id: "f1",
              name: "report.pdf",
              path: "user-123/v1/report.pdf",
              extracted_text: "cached text",
              extraction_status: "completed",
            },
          ],
        },
      },
      error: null,
    });

    const req = makeJsonRequest("/api/encounters/v1/extract", { fileId: "f1" });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.text).toBe("cached text");
  });

  it("returns in-progress when already extracting", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: {
        ...defaultVisit,
        metadata: {
          files: [
            {
              id: "f1",
              name: "report.pdf",
              path: "user-123/v1/report.pdf",
              extraction_status: "extracting",
            },
          ],
        },
      },
      error: null,
    });

    const req = makeJsonRequest("/api/encounters/v1/extract", { fileId: "f1" });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inProgress).toBe(true);
  });

  it("extracts text and saves via RPC on success", async () => {
    const req = makeJsonRequest("/api/encounters/v1/extract", { fileId: "f1" });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.extracted).toBe(true);
    expect(body.text).toBe("extracted content");
    expect(mockExtractFileText).toHaveBeenCalledOnce();
    // Should call RPC twice: once for "extracting", once for "completed"
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "update_file_extraction_status",
      {
        p_visit_id: "v1",
        p_file_id: "f1",
        p_status: "completed",
        p_extracted_text: "extracted content",
      },
    );
  });

  it("marks as failed when extraction throws", async () => {
    mockExtractFileText.mockRejectedValueOnce(new Error("OCR failed"));
    const req = makeJsonRequest("/api/encounters/v1/extract", { fileId: "f1" });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(500);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "update_file_extraction_status",
      {
        p_visit_id: "v1",
        p_file_id: "f1",
        p_status: "failed",
      },
    );
  });

  it("marks as failed when extracted text is empty", async () => {
    mockExtractFileText.mockResolvedValueOnce({ text: "", elapsedMs: 50 });
    const req = makeJsonRequest("/api/encounters/v1/extract", { fileId: "f1" });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("empty");
  });

  it("returns 500 when RPC save fails after retries", async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ error: null }) // "extracting" status
      .mockResolvedValue({ error: { message: "rpc failed" } }); // all "completed" attempts fail

    const req = makeJsonRequest("/api/encounters/v1/extract", { fileId: "f1" });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("save");
  }, 30000);

  it("silently exits without retries when file is deleted mid-extraction", async () => {
    // "extracting" status succeeds; then the user deletes the file
    // mid-OCR — the "completed" save RPC returns the database's
    // "File not found" error (code P0001).
    mockSupabase.rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({
        error: { code: "P0001", message: "File not found: f1" },
      });

    const req = makeJsonRequest("/api/encounters/v1/extract", { fileId: "f1" });
    const res = await POST(req, routeParams());

    // Only 2 RPC calls — no retries (file is gone, retrying won't help).
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(2);

    // No error logs — this is expected behaviour, not a bug.
    const { logger } = await import("@/lib/logger");
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();

    // Response: 200 with a flag indicating the file was deleted.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fileDeleted).toBe(true);
  });

  it("returns 400 when file has no path", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: {
        ...defaultVisit,
        metadata: {
          files: [
            {
              id: "f1",
              name: "report.pdf",
              extraction_status: "pending",
            },
          ],
        },
      },
      error: null,
    });

    const req = makeJsonRequest("/api/encounters/v1/extract", { fileId: "f1" });
    const res = await POST(req, routeParams());
    expect(res.status).toBe(400);
  });
});
