import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

// Mock env modules (transitively imported by dependencies)
vi.mock("@/lib/env/server", () => ({
  serverEnv: { NODE_ENV: "test" },
}));

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-key",
    NEXT_PUBLIC_APP_URL: "",
  },
}));

// Mock dependencies
vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/anthropic", () => ({
  anthropic: vi.fn().mockReturnValue({
    messages: {
      stream: vi.fn().mockReturnValue({
        on: vi.fn(),
        finalMessage: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: '{"section1": "content"}' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      }),
    },
  }),
  GENERATION_MODELS: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  MODEL_FALLBACK_DELAY: 100,
  buildTemplateSystemPrompt: vi.fn().mockReturnValue("System prompt"),
  buildTemplateUserMessage: vi.fn().mockReturnValue("User message"),
}));

vi.mock("@/lib/templates/server", () => ({
  resolveTemplate: vi.fn().mockResolvedValue({
    id: "default",
    sections: [],
  }),
}));

vi.mock("@/lib/templates/html", () => ({
  buildTemplateHtml: vi.fn().mockReturnValue("<html></html>"),
  flattenSectionIds: vi.fn().mockReturnValue(["section1"]),
}));

vi.mock("@/lib/templates", () => ({
  DEFAULT_TEMPLATE_ID: "default-template",
  buildSectionLabelsFromTemplate: vi.fn().mockReturnValue({}),
  buildSectionContextsFromTemplate: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/clinical", () => ({
  runClinicalAnalysis: vi.fn().mockResolvedValue({}),
  buildEnrichedSystemPrompt: vi.fn().mockReturnValue("Enriched prompt"),
  extractJson: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/usage", () => ({
  logUsage: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  createAuditContext: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/api/sse", () => ({
  createSSEStream: vi.fn().mockReturnValue(new ReadableStream()),
  sseResponse: vi.fn().mockReturnValue(new Response()),
  extractSectionsFromStream: vi.fn(),
}));

vi.mock("@/lib/parse-note-sections", () => ({
  parseNoteToSectionMap: vi.fn().mockReturnValue({}),
}));

import { requireAuth } from "@/lib/supabase/auth";

describe("POST /api/regenerate - validation", () => {
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(),
    update: vi.fn().mockReturnThis(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(requireAuth).mockResolvedValue({
      userId: "user-123",
      supabase: mockSupabase as never,
      isImpersonating: false,
      realUserId: "user-123",
      realUserEmail: "test@example.com",
    });

    // Default: visit found with chunks
    mockSupabase.single.mockResolvedValue({
      data: {
        id: "visit-123",
        language: "en",
        metadata: { files: [] },
        encounter_note: null,
      },
      error: null,
    });

    // Default: chunks returned from order()
    mockSupabase.order.mockResolvedValue({
      data: [{ id: "chunk-1", content: "Patient has a headache" }],
      error: null,
    });
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    const request = new NextRequest("http://localhost/api/regenerate", {
      method: "POST",
      body: JSON.stringify({ visitId: "visit-123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 401 for non-Response auth errors", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error("Auth failed"));

    const request = new NextRequest("http://localhost/api/regenerate", {
      method: "POST",
      body: JSON.stringify({ visitId: "visit-123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 when visitId is missing", async () => {
    const request = new NextRequest("http://localhost/api/regenerate", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toContain("visitId");
  });

  it("returns 404 when visit not found", async () => {
    mockSupabase.single.mockResolvedValue({
      data: null,
      error: { message: "Not found" },
    });

    const request = new NextRequest("http://localhost/api/regenerate", {
      method: "POST",
      body: JSON.stringify({ visitId: "nonexistent" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
  });

  it("returns 404 when no transcript, notes, or files available", async () => {
    // No chunks
    mockSupabase.order.mockResolvedValue({
      data: [],
      error: null,
    });

    const request = new NextRequest("http://localhost/api/regenerate", {
      method: "POST",
      body: JSON.stringify({ visitId: "visit-123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain("No transcript");
  });

  it("accepts request with doctor notes even without chunks", async () => {
    // No chunks
    mockSupabase.order.mockResolvedValue({
      data: [],
      error: null,
    });

    const request = new NextRequest("http://localhost/api/regenerate", {
      method: "POST",
      body: JSON.stringify({
        visitId: "visit-123",
        doctorNotes: "Patient follow-up",
      }),
    });

    const response = await POST(request);
    // Should NOT be 404 since doctorNotes is provided
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(400);
  });

  it("logs audit event on valid request", async () => {
    const { logAudit } = await import("@/lib/audit");

    const request = new NextRequest("http://localhost/api/regenerate", {
      method: "POST",
      body: JSON.stringify({ visitId: "visit-123" }),
    });

    await POST(request);

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "encounter.regenerate",
        resourceType: "encounter",
        resourceId: "visit-123",
      }),
    );
  });
});
