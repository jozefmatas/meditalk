// @vitest-environment node
/**
 * Verifies that `NoteSkeleton`, when provided, is embedded in the user
 * message of the critic call (and format is deterministic so the
 * Anthropic prompt-cache key stays stable across renders).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));
vi.mock("../usage", () => ({
  logUsage: vi.fn(),
}));

import { criticPass } from "./critic";
import type { NoteSkeleton } from "./note-skeleton";
import type { RawSource } from "./section-agent";

function mockResponse(text: string) {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "submit_corrected_section",
        input: { corrected: text },
      },
    ],
    usage: { input_tokens: 20, output_tokens: 5 },
    stop_reason: "tool_use",
  };
}

const SOURCE: RawSource = { doctorNotes: "Patient presents with chest pain." };

const SKELETON: NoteSkeleton = {
  chiefComplaint: "Chest pain with suspected lateral STEMI.",
  clinicalSummary:
    "62-year-old male, known 2-vessel CAD post-PCI on RIA, now with persistent stenocardia. Transfer from referring facility for rekoronarografia.",
  encounterType: "transfer",
  keyDates: [{ label: "Prior PCI (RIA)", iso: "2025-09-26" }],
  primarySystems: ["cardiovascular"],
  providers: ["Dr. Baldovský", "CINRE"],
  criticalFindings: ["2-vessel CAD", "EF ~50%"],
  confidence: "high",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("skeleton threading — critic", () => {
  it("embeds the skeleton block in the user message when provided", async () => {
    mockCreate.mockResolvedValue(mockResponse("x"));

    await criticPass({
      draft: "draft",
      source: SOURCE,
      sectionId: "to",
      sectionTitle: "TO",
      sectionContext: "HPI synthesis.",
      language: "sk",
      skeleton: SKELETON,
    });

    const userMessage = mockCreate.mock.calls[0][0].messages[0]
      .content as string;
    expect(userMessage).toContain("Shared encounter context");
    expect(userMessage).toContain("Chief complaint: Chest pain");
    expect(userMessage).toContain("Encounter type: transfer");
    expect(userMessage).toContain("Providers / facilities: Dr. Baldovský, CINRE");
    // Critical: source is still in the same message AFTER the skeleton.
    const skIdx = userMessage.indexOf("Shared encounter context");
    const srcIdx = userMessage.indexOf("# Raw source");
    expect(skIdx).toBeGreaterThanOrEqual(0);
    expect(srcIdx).toBeGreaterThan(skIdx);
  });

  it("omits the skeleton block when skeleton is null/undefined (backwards-compatible)", async () => {
    mockCreate.mockResolvedValue(mockResponse("x"));

    await criticPass({
      draft: "draft",
      source: SOURCE,
      sectionId: "to",
      sectionTitle: "TO",
      sectionContext: "HPI synthesis.",
      language: "sk",
      // no skeleton
    });

    const userMessage = mockCreate.mock.calls[0][0].messages[0]
      .content as string;
    expect(userMessage).not.toContain("Shared encounter context");
    expect(userMessage).toContain("# Raw source");
  });

  it("skeleton block is deterministic (same input → same bytes)", async () => {
    mockCreate.mockResolvedValue(mockResponse("x"));
    await criticPass({
      draft: "draft",
      source: SOURCE,
      sectionId: "to",
      sectionTitle: "TO",
      sectionContext: "HPI synthesis.",
      language: "sk",
      skeleton: SKELETON,
    });
    const firstUserMsg = mockCreate.mock.calls[0][0].messages[0]
      .content as string;

    mockCreate.mockClear();
    mockCreate.mockResolvedValue(mockResponse("x"));
    await criticPass({
      draft: "draft",
      source: SOURCE,
      sectionId: "to",
      sectionTitle: "TO",
      sectionContext: "HPI synthesis.",
      language: "sk",
      skeleton: SKELETON,
    });
    const secondUserMsg = mockCreate.mock.calls[0][0].messages[0]
      .content as string;

    expect(firstUserMsg).toBe(secondUserMsg);
  });
});
