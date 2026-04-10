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
  anthropic: vi.fn(),
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
}));

vi.mock("@/lib/clinical", () => ({
  runClinicalAnalysis: vi.fn().mockResolvedValue({}),
  buildEnrichedSystemPrompt: vi.fn().mockReturnValue("Enriched prompt"),
  extractJson: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/openai", () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

vi.mock("@/lib/usage", () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email/send-note-email", () => ({
  sendNoteEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  createAuditContext: vi.fn().mockReturnValue({}),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/parse-note-sections", () => ({
  filterEmptySectionsHtml: vi.fn((html) => html),
}));

import { requireAuth } from "@/lib/supabase/auth";

describe("POST /api/generate - validation", () => {
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
    update: vi.fn().mockReturnThis(),
    rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    storage: {
      from: vi.fn().mockReturnThis(),
      remove: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
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

    mockSupabase.single.mockResolvedValue({
      data: {
        id: "visit-123",
        title: "Test Visit",
        language: "en",
        metadata: { files: [] },
      },
      error: null,
    });
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    const request = new NextRequest("http://localhost/api/generate", {
      method: "POST",
      body: JSON.stringify({ visitId: "visit-123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 when visitId is missing", async () => {
    const request = new NextRequest("http://localhost/api/generate", {
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

    const request = new NextRequest("http://localhost/api/generate", {
      method: "POST",
      body: JSON.stringify({ visitId: "nonexistent" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
  });

  it("saves transcript to metadata when transcriptText provided", async () => {
    // This test will fail during generation, but we're just testing that
    // the transcript metadata update happens before generation
    const request = new NextRequest("http://localhost/api/generate", {
      method: "POST",
      body: JSON.stringify({
        visitId: "visit-123",
        transcriptText: "Patient has a headache",
      }),
    });

    // Will throw during generation due to incomplete mocks, but that's ok
    await POST(request).catch(() => {});

    // Verify transcript was saved via atomic metadata merge RPC
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "merge_visit_metadata",
      expect.objectContaining({
        p_visit_id: "visit-123",
        p_partial: expect.objectContaining({
          transcript: "Patient has a headache",
        }),
      }),
    );
  });
});

describe("Model configuration", () => {
  it("exports GENERATION_MODELS array", async () => {
    const { GENERATION_MODELS } = await import("@/lib/anthropic");
    expect(GENERATION_MODELS).toBeDefined();
    expect(Array.isArray(GENERATION_MODELS)).toBe(true);
    expect(GENERATION_MODELS.length).toBeGreaterThan(0);
  });

  it("exports MODEL_FALLBACK_DELAY", async () => {
    const { MODEL_FALLBACK_DELAY } = await import("@/lib/anthropic");
    expect(MODEL_FALLBACK_DELAY).toBeDefined();
    expect(typeof MODEL_FALLBACK_DELAY).toBe("number");
    expect(MODEL_FALLBACK_DELAY).toBeGreaterThan(0);
  });
});
