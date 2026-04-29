// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, makeJsonRequest } from "@/test/route-helpers";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSupabase = createMockSupabase();

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    userId: "user-123",
    supabase: mockSupabase,
    user: { email: "test@example.com" },
  }),
}));

const mockDispatchNoteEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email/send-note-email", () => ({
  dispatchNoteEmail: mockDispatchNoteEmail,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  createAuditContext: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { POST } = await import("./route");

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/send-note-email", () => {
  it("returns 400 when visitId is missing", async () => {
    const res = await POST(makeJsonRequest("/api/send-note-email", {}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when encounter not found", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { message: "not found" },
    });
    const res = await POST(
      makeJsonRequest("/api/send-note-email", { visitId: "v1" }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when encounter has no note", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: { title: "Visit", encounter_note: null, language: "sk" },
      error: null,
    });
    const res = await POST(
      makeJsonRequest("/api/send-note-email", { visitId: "v1" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No generated note");
  });

  it("dispatches email on success", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: {
        title: "Patient Visit",
        encounter_note: "<p>Note content</p>",
        language: "sk",
      },
      error: null,
    });

    const res = await POST(
      makeJsonRequest("/api/send-note-email", { visitId: "v1" }),
    );
    expect(res.status).toBe(200);
    expect(mockDispatchNoteEmail).toHaveBeenCalledWith({
      userId: "user-123",
      visitId: "v1",
      title: "Patient Visit",
      noteHtml: "<p>Note content</p>",
      language: "sk",
    });
  });

  it("returns 500 when email dispatch fails", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: {
        title: "Visit",
        encounter_note: "<p>Note</p>",
        language: "sk",
      },
      error: null,
    });
    mockDispatchNoteEmail.mockRejectedValueOnce(new Error("SMTP error"));

    const res = await POST(
      makeJsonRequest("/api/send-note-email", { visitId: "v1" }),
    );
    expect(res.status).toBe(500);
  });
});
