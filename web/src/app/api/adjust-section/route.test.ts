// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

const mockMessagesCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockMessagesCreate };
    },
  };
});

vi.mock("@/lib/encounters/sources", () => ({
  getTranscript: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { getTranscript } = await import("@/lib/encounters/sources");
const mockGetTranscript = vi.mocked(getTranscript);
const { POST } = await import("./route");

// ── Helpers ───────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/adjust-section", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function authedUser() {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
  });
}

function visitExists(metadata: Record<string, unknown> = {}) {
  mockSupabase.single.mockResolvedValue({
    data: { id: "v1", user_id: "user-1", metadata },
    error: null,
  });
}

function claudeReturns(text: string) {
  mockMessagesCreate.mockResolvedValue({
    content: [{ type: "text", text }],
  });
}

/** Extract the prompt string sent to Claude */
function capturedPrompt(): string {
  const call = mockMessagesCreate.mock.calls[0];
  return call[0].messages[0].content;
}

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTranscript.mockReturnValue(null);
});

describe("POST /api/adjust-section", () => {
  // ── Validation ──────────────────────────────────────────────────

  it("returns 400 when required fields are missing", async () => {
    const res = await POST(makeRequest({ visitId: "v1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing required fields");
  });

  it("returns 400 when neither currentContent nor subsections provided", async () => {
    const res = await POST(
      makeRequest({
        visitId: "v1",
        sectionId: "s1",
        feedbackText: "fix this",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Either currentContent");
  });

  it("returns 401 when user is not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(
      makeRequest({
        visitId: "v1",
        sectionId: "s1",
        feedbackText: "fix this",
        currentContent: "some content",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when visit is not found", async () => {
    authedUser();
    mockSupabase.single.mockResolvedValue({
      data: null,
      error: { message: "not found" },
    });

    const res = await POST(
      makeRequest({
        visitId: "v1",
        sectionId: "s1",
        feedbackText: "fix this",
        currentContent: "some content",
      }),
    );
    expect(res.status).toBe(404);
  });

  // ── Single section adjustment ───────────────────────────────────

  it("adjusts a single section and returns updated content", async () => {
    authedUser();
    visitExists();
    claudeReturns("Fixed typo in diagnosis.");

    const res = await POST(
      makeRequest({
        visitId: "v1",
        sectionId: "diagnosis",
        currentContent: "Patient has hypertensoin",
        feedbackText: "Fix the typo",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sectionId).toBe("diagnosis");
    expect(body.content).toBe("Fixed typo in diagnosis.");
  });

  it("works without otherSectionContents (backward compat)", async () => {
    authedUser();
    visitExists();
    claudeReturns("Adjusted content.");

    const res = await POST(
      makeRequest({
        visitId: "v1",
        sectionId: "s1",
        currentContent: "Old content",
        feedbackText: "Improve this",
      }),
    );

    expect(res.status).toBe(200);
    const prompt = capturedPrompt();
    expect(prompt).not.toContain("OTHER SECTIONS OF THE NOTE");
  });

  // ── Note context (other sections) ──────────────────────────────

  it("includes other section contents in prompt when adjusting a single section", async () => {
    authedUser();
    visitExists();
    claudeReturns("Conclusion based on lab results.");

    const res = await POST(
      makeRequest({
        visitId: "v1",
        sectionId: "conclusion",
        currentContent: "Old meta-commentary",
        feedbackText: "Write a proper conclusion",
        otherSectionContents: {
          labs: "Hemoglobin 14.2 g/dL, WBC 7.8",
          objective: "BP 120/80, HR 72",
        },
        sectionLabels: {
          labs: "Laboratórne výsledky",
          objective: "Objektívne vyšetrenie",
        },
      }),
    );

    expect(res.status).toBe(200);
    const prompt = capturedPrompt();
    expect(prompt).toContain("OTHER SECTIONS OF THE NOTE");
    expect(prompt).toContain("Laboratórne výsledky");
    expect(prompt).toContain("Hemoglobin 14.2 g/dL");
    expect(prompt).toContain("Objektívne vyšetrenie");
    expect(prompt).toContain("BP 120/80");
  });

  it("uses section IDs as labels when sectionLabels not provided", async () => {
    authedUser();
    visitExists();
    claudeReturns("Updated.");

    await POST(
      makeRequest({
        visitId: "v1",
        sectionId: "conclusion",
        currentContent: "Old content",
        feedbackText: "Improve",
        otherSectionContents: { labs: "WBC 7.8" },
      }),
    );

    const prompt = capturedPrompt();
    expect(prompt).toContain("### labs");
    expect(prompt).toContain("WBC 7.8");
  });

  it("filters out empty sections from note context", async () => {
    authedUser();
    visitExists();
    claudeReturns("Updated.");

    await POST(
      makeRequest({
        visitId: "v1",
        sectionId: "conclusion",
        currentContent: "Old content",
        feedbackText: "Improve",
        otherSectionContents: {
          labs: "WBC 7.8",
          empty_section: "",
          whitespace_section: "   ",
        },
        sectionLabels: { labs: "Lab Results" },
      }),
    );

    const prompt = capturedPrompt();
    expect(prompt).toContain("Lab Results");
    expect(prompt).toContain("WBC 7.8");
    expect(prompt).not.toContain("empty_section");
    expect(prompt).not.toContain("whitespace_section");
  });

  // ── Parent section adjustment ───────────────────────────────────

  it("adjusts a parent section and returns subsection updates", async () => {
    authedUser();
    visitExists();
    claudeReturns('{"bp": "120/80 mmHg — normal"}');

    const res = await POST(
      makeRequest({
        visitId: "v1",
        sectionId: "vitals",
        feedbackText: "Blood pressure is 120/80",
        subsections: { bp: "", hr: "72 bpm" },
        subsectionLabels: { bp: "Blood Pressure", hr: "Heart Rate" },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updates).toEqual({ bp: "120/80 mmHg — normal" });
  });

  it("includes note context in parent section prompt", async () => {
    authedUser();
    visitExists();
    claudeReturns("{}");

    await POST(
      makeRequest({
        visitId: "v1",
        sectionId: "vitals",
        feedbackText: "Update based on labs",
        subsections: { bp: "120/80" },
        subsectionLabels: { bp: "Blood Pressure" },
        otherSectionContents: { labs: "Hemoglobin 14.2 g/dL" },
        sectionLabels: { labs: "Lab Results" },
      }),
    );

    const prompt = capturedPrompt();
    expect(prompt).toContain("OTHER SECTIONS OF THE NOTE");
    expect(prompt).toContain("Lab Results");
    expect(prompt).toContain("Hemoglobin 14.2 g/dL");
  });

  // ── Raw sources integration ─────────────────────────────────────

  it("includes raw sources when available alongside note context", async () => {
    authedUser();
    mockGetTranscript.mockReturnValue("Doctor said patient has headache");
    visitExists({ doctor_notes: "Chronic migraine" });
    claudeReturns("Updated with sources.");

    await POST(
      makeRequest({
        visitId: "v1",
        sectionId: "conclusion",
        currentContent: "Old content",
        feedbackText: "Improve conclusion",
        otherSectionContents: { labs: "WBC normal" },
        sectionLabels: { labs: "Lab Results" },
      }),
    );

    const prompt = capturedPrompt();
    // Raw sources present
    expect(prompt).toContain("ORIGINAL SOURCES");
    expect(prompt).toContain("Consultation Transcript");
    expect(prompt).toContain("Doctor said patient has headache");
    expect(prompt).toContain("Doctor's Notes");
    expect(prompt).toContain("Chronic migraine");
    // Note context also present
    expect(prompt).toContain("OTHER SECTIONS OF THE NOTE");
    expect(prompt).toContain("Lab Results");
  });
});
