// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractWithDirective } from "./file-focus";

// ── Mock the models layer ────────────────────────────────────────

const mockGenerate = vi.fn();

vi.mock("../models", () => ({
  resolve: () => ({
    name: "anthropic",
    model: "claude-haiku-test",
    supportsToolUse: true,
    supportsPromptCache: false,
    generate: mockGenerate,
  }),
}));

vi.mock("../usage", () => ({
  logUsage: vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helper ───────────────────────────────────────────────────────

function providerReturnsPassages(
  passages: Array<{ text: string; category?: string }>,
) {
  mockGenerate.mockResolvedValue({
    toolInput: { passages },
    usage: { inputTokens: 100, outputTokens: 50 },
    providerRaw: {},
  });
}

// ── Tests ────────────────────────────────────────────────────────

describe("extractWithDirective", () => {
  it("keeps passages when whitespace differs from source (newlines vs spaces)", async () => {
    // Source text has newlines mid-paragraph (typical OCR output)
    const sourceText = "ECHOKG\nLK normálna veľkosť\na funkcia";

    // Haiku returns the same content but with newlines collapsed to spaces
    providerReturnsPassages([
      {
        text: "ECHOKG LK normálna veľkosť a funkcia",
        category: "finding",
      },
    ]);

    const result = await extractWithDirective({
      text: sourceText,
      directive: "echokg",
      fileName: "echokg.pdf",
    });

    // Passage should be KEPT despite whitespace differences
    expect(result.classifiedPassages).toHaveLength(1);
    expect(result.classifiedPassages[0].category).toBe("finding");
    expect(result.text).toBeTruthy();
  });

  it("falls back to original text when ALL passages are ungrounded", async () => {
    const sourceText = "Pacient má hypertenziu a diabetes mellitus 2. typu.";

    // Haiku returns completely fabricated passages not in source
    providerReturnsPassages([
      {
        text: "This passage was hallucinated by the model",
        category: "finding",
      },
      {
        text: "Another fabricated passage not in source",
        category: "diagnosis",
      },
    ]);

    const result = await extractWithDirective({
      text: sourceText,
      directive: "diagnózy",
      fileName: "report.pdf",
    });

    // Should fall back to original text, not return empty
    expect(result.text).toBe(sourceText);
    expect(result.classifiedPassages).toHaveLength(0);
  });

  it("drops individual ungrounded passages when some pass validation", async () => {
    const sourceText =
      "Záver: Hypertenzia gr. II, Diabetes mellitus 2. typu na PAD.";

    providerReturnsPassages([
      // Valid — exact substring of source
      { text: "Hypertenzia gr. II", category: "diagnosis" },
      // Fabricated — not in source
      { text: "Kompletne vymyslený text", category: "finding" },
    ]);

    const result = await extractWithDirective({
      text: sourceText,
      directive: "diagnózy",
      fileName: "report.pdf",
    });

    // Only the valid passage should be kept
    expect(result.classifiedPassages).toHaveLength(1);
    expect(result.classifiedPassages[0].text).toBe("Hypertenzia gr. II");
    expect(result.text).toBe("Hypertenzia gr. II");
  });

  it("keeps passages via word-overlap when punctuation/formatting differs", async () => {
    // OCR source has specific formatting (en-dash, colon spacing, etc.)
    const sourceText =
      "ECHOKG:\nLK – normálna veľkosť, EF 55 %, bez regionálnych porúch kinetiky.\nMitrálna regurgitácia I. st.";

    // Haiku returns near-verbatim but with minor differences:
    // - regular dash instead of en-dash
    // - "55%" instead of "55 %"
    // - period instead of comma
    providerReturnsPassages([
      {
        text: "LK - normálna veľkosť, EF 55%, bez regionálnych porúch kinetiky. Mitrálna regurgitácia I. st.",
        category: "finding",
      },
    ]);

    const result = await extractWithDirective({
      text: sourceText,
      directive: "echokg",
      fileName: "echokg.pdf",
    });

    // Should KEEP via word-overlap even though substring match fails
    expect(result.classifiedPassages).toHaveLength(1);
    expect(result.classifiedPassages[0].category).toBe("finding");
  });

  it("still rejects truly hallucinated passages even with word-overlap check", async () => {
    const sourceText =
      "ECHOKG: LK normálna veľkosť, EF 55%, bez porúch kinetiky.";

    // Haiku invents completely different medical content
    providerReturnsPassages([
      {
        text: "Pacient má diabetes mellitus 2. typu na perorálnych antidiabetikách s HbA1c 7.2%.",
        category: "diagnosis",
      },
    ]);

    const result = await extractWithDirective({
      text: sourceText,
      directive: "echokg",
      fileName: "echokg.pdf",
    });

    // Should fall back to full text (hallucinated passage rejected)
    expect(result.text).toBe(sourceText);
    expect(result.classifiedPassages).toHaveLength(0);
  });
});
