// @vitest-environment node
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
import type { RawSource } from "./section-agent";

function mockTextResponse(text: string) {
  // The critic now uses a forced tool call (submit_corrected_section)
  // for its output. Mimic Anthropic's tool_use response shape.
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_test_1",
        name: "submit_corrected_section",
        input: { corrected: text },
      },
    ],
    usage: { input_tokens: 40, output_tokens: 15 },
    stop_reason: "tool_use",
  };
}

const SOURCE: RawSource = {
  doctorNotes:
    "Pacient berie Anopyrin 100 mg 1-0-0. Hypertenzia III. stupňa. Dnes dušný.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("criticPass — happy path", () => {
  it("returns changed=true when the draft is corrected", async () => {
    mockCreate.mockResolvedValue(mockTextResponse("Anopyrin 100 mg 1-0-0"));

    const result = await criticPass({
      draft: "Anopyrin 100 mg 1-0-0, Warfarin 5 mg", // Warfarin invented
      source: SOURCE,
      sectionId: "la",
      sectionTitle: "LA",
      sectionContext: "Medications only.",
      language: "sk",
    });

    expect(result.content).toBe("Anopyrin 100 mg 1-0-0");
    expect(result.changed).toBe(true);
    expect(result.diffSummary).toMatch(/len/);
  });

  it("returns changed=false when draft is already faithful", async () => {
    const faithful = "Anopyrin 100 mg 1-0-0";
    mockCreate.mockResolvedValue(mockTextResponse(faithful));

    const result = await criticPass({
      draft: faithful,
      source: SOURCE,
      sectionId: "la",
      sectionTitle: "LA",
      sectionContext: "Medications only.",
      language: "sk",
    });

    expect(result.content).toBe(faithful);
    expect(result.changed).toBe(false);
    expect(result.diffSummary).toBe("no change");
  });
});

describe("criticPass — empty input short-circuit", () => {
  it("returns empty input unchanged without calling the API", async () => {
    const result = await criticPass({
      draft: "",
      source: SOURCE,
      sectionId: "la",
      sectionTitle: "LA",
      sectionContext: "Medications only.",
      language: "sk",
    });
    expect(result.content).toBe("");
    expect(result.changed).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("treats whitespace-only input as empty", async () => {
    const result = await criticPass({
      draft: "   \n  ",
      source: SOURCE,
      sectionId: "la",
      sectionTitle: "LA",
      sectionContext: "Medications only.",
      language: "sk",
    });
    expect(result.content).toBe("   \n  ");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("criticPass — prompt construction", () => {
  it("includes raw source AND the draft in the user message", async () => {
    mockCreate.mockResolvedValue(mockTextResponse("x"));

    await criticPass({
      draft: "draft text here",
      source: SOURCE,
      sectionId: "la",
      sectionTitle: "LA",
      sectionContext: "Medications only.",
      language: "sk",
    });

    const userMessage = mockCreate.mock.calls[0][0].messages[0]
      .content as string;
    expect(userMessage).toContain("# Raw source");
    expect(userMessage).toContain(
      "Pacient berie Anopyrin 100 mg 1-0-0. Hypertenzia III. stupňa.",
    );
    expect(userMessage).toContain('# Current "LA" draft');
    expect(userMessage).toContain("draft text here");
  });

  it("includes the section contract in the SYSTEM prompt", async () => {
    mockCreate.mockResolvedValue(mockTextResponse("x"));

    const contextText =
      "NEVER list medications in Postup a plán — they belong to LA.";

    await criticPass({
      draft: "x",
      source: SOURCE,
      sectionId: "plan",
      sectionTitle: "Postup a plán",
      sectionContext: contextText,
      language: "sk",
    });

    const system = mockCreate.mock.calls[0][0].system as Array<{
      text: string;
    }>;
    const allText = system.map((b) => b.text).join("\n");
    expect(allText).toContain(contextText);
    expect(allText).toMatch(/audit a draft/i);
  });

  it("sets temperature=0 for determinism", async () => {
    mockCreate.mockResolvedValue(mockTextResponse("x"));

    await criticPass({
      draft: "x",
      source: SOURCE,
      sectionId: "la",
      sectionTitle: "LA",
      sectionContext: "Medications only.",
      language: "sk",
    });

    expect(mockCreate.mock.calls[0][0].temperature).toBe(0);
  });

  it("does NOT include fact-layer references in the prompt (critic is source-only)", async () => {
    mockCreate.mockResolvedValue(mockTextResponse("x"));

    await criticPass({
      draft: "x",
      source: SOURCE,
      sectionId: "la",
      sectionTitle: "LA",
      sectionContext: "Medications only.",
      language: "sk",
    });

    const system = mockCreate.mock.calls[0][0].system as Array<{
      text: string;
    }>;
    const allText = system.map((b) => b.text).join("\n");
    const userMessage = mockCreate.mock.calls[0][0].messages[0]
      .content as string;
    expect(allText).not.toMatch(/verified facts/i);
    expect(userMessage).not.toMatch(/# Facts/);
  });
});

describe("criticPass — failure modes", () => {
  it("propagates API failures — caller decides whether to fall back", async () => {
    mockCreate.mockRejectedValue(new Error("network"));

    await expect(
      criticPass({
        draft: "x",
        source: SOURCE,
        sectionId: "la",
        sectionTitle: "LA",
        sectionContext: "Medications only.",
        language: "sk",
      }),
    ).rejects.toThrow();
  });
});
