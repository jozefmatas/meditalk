import { describe, it, expect, vi } from "vitest";

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

import {
  buildFactBasedSystemPrompt,
  buildTemplateSystemPrompt,
  buildTemplateUserMessage,
  buildTitleSystemPrompt,
  buildTitleUserMessage,
  sanitizeGeneratedTitle,
  stripBulletMarkers,
  InsufficientContextError,
  NOT_STATED,
  GENERATION_MODELS,
  GENERATION_MODEL,
  MODEL_FALLBACK_DELAY,
  TITLE_GENERATION_MODEL,
} from "./anthropic";
import type { Template } from "./templates/types";
import type { CandidateIcdCode } from "./clinical/types";

// ── Test fixtures ──

const SIMPLE_TEMPLATE: Template = {
  id: "test-template",
  name: { en: "Test Template", sk: "Testovacia šablóna" },
  description: { en: "A test template", sk: "Testovacia šablóna" },
  sections: [
    {
      id: "subjective",
      labels: { en: "Subjective", sk: "Subjektívne" },
    },
    {
      id: "objective",
      labels: { en: "Objective", sk: "Objektívne" },
    },
    {
      id: "assessment",
      labels: { en: "Assessment", sk: "Hodnotenie" },
    },
  ],
};

const TEMPLATE_WITH_SUBSECTIONS: Template = {
  id: "nested-template",
  name: { en: "Nested", sk: "Vnorená" },
  description: { en: "Template with subsections", sk: "So subsekciami" },
  sections: [
    {
      id: "history",
      labels: { en: "History", sk: "Anamnéza" },
      subsections: [
        {
          id: "present_illness",
          labels: { en: "Present Illness", sk: "Súčasné ochorenie" },
        },
        {
          id: "past_history",
          labels: { en: "Past History", sk: "Osobná anamnéza" },
          context: "Include surgeries and hospitalizations",
        },
      ],
    },
    {
      id: "plan",
      labels: { en: "Plan", sk: "Plán" },
      context: "List medications and follow-up",
    },
  ],
};

const TEMPLATE_WITH_CUSTOM_PROMPT: Template = {
  id: "custom-prompt",
  name: { en: "Custom", sk: "Vlastná" },
  description: { en: "Custom prompt", sk: "Vlastný prompt" },
  sections: [{ id: "notes", labels: { en: "Notes", sk: "Poznámky" } }],
  systemPrompt:
    "Custom prompt for {{language}}. Sections: {{sections}}{{styleGuide}}",
};

const TEMPLATE_WITH_STYLE_GUIDE: Template = {
  id: "style-guide",
  name: { en: "Styled", sk: "So štýlom" },
  description: { en: "With style guide", sk: "So štýlom" },
  sections: [{ id: "notes", labels: { en: "Notes", sk: "Poznámky" } }],
  styleGuide: "Write in short telegraphic sentences. Use abbreviations freely.",
};

const SECTION_LABELS: Record<string, string> = {
  subjective: "Subjective",
  objective: "Objective",
  assessment: "Assessment",
};

// ── Tests ──

describe("NOT_STATED", () => {
  it("has entries for all supported languages", () => {
    expect(NOT_STATED.en).toBe("Not stated");
    expect(NOT_STATED.sk).toBe("Neuvedené");
    expect(NOT_STATED.cs).toBe("Neuvedeno");
  });
});

describe("InsufficientContextError", () => {
  it("is an instance of Error", () => {
    const err = new InsufficientContextError();
    expect(err).toBeInstanceOf(Error);
  });

  it("has the correct message", () => {
    const err = new InsufficientContextError();
    expect(err.message).toBe("insufficient_context");
  });

  it("has the correct name", () => {
    const err = new InsufficientContextError();
    expect(err.name).toBe("InsufficientContextError");
  });
});

describe("GENERATION_MODELS", () => {
  it("is a non-empty array of model IDs", () => {
    expect(GENERATION_MODELS.length).toBeGreaterThan(0);
    for (const m of GENERATION_MODELS) {
      expect(typeof m).toBe("string");
      expect(m.length).toBeGreaterThan(0);
    }
  });

  it("GENERATION_MODEL is the first model", () => {
    expect(GENERATION_MODEL).toBe(GENERATION_MODELS[0]);
  });

  it("MODEL_FALLBACK_DELAY is a positive number", () => {
    expect(MODEL_FALLBACK_DELAY).toBeGreaterThan(0);
  });
});

describe("buildTemplateSystemPrompt", () => {
  it("includes the language name in the prompt", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain("English");
  });

  it("includes all section IDs in the prompt", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain('"subjective"');
    expect(prompt).toContain('"objective"');
    expect(prompt).toContain('"assessment"');
  });

  it("includes section labels next to IDs", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain("Subjective");
    expect(prompt).toContain("Objective");
    expect(prompt).toContain("Assessment");
  });

  it("includes subsection IDs for nested templates", () => {
    const labels: Record<string, string> = {
      history: "History",
      present_illness: "Present Illness",
      past_history: "Past History",
      plan: "Plan",
    };
    const prompt = buildTemplateSystemPrompt(
      TEMPLATE_WITH_SUBSECTIONS,
      "en",
      labels,
    );
    expect(prompt).toContain('"present_illness"');
    expect(prompt).toContain('"past_history"');
    expect(prompt).toContain('"plan"');
  });

  it("includes section context as guidance", () => {
    const labels: Record<string, string> = {
      history: "History",
      present_illness: "Present Illness",
      past_history: "Past History",
      plan: "Plan",
    };
    const contexts: Record<string, string> = {
      past_history: "Include surgeries and hospitalizations",
      plan: "List medications and follow-up",
    };
    const prompt = buildTemplateSystemPrompt(
      TEMPLATE_WITH_SUBSECTIONS,
      "en",
      labels,
      contexts,
    );
    expect(prompt).toContain("Include surgeries and hospitalizations");
    expect(prompt).toContain("List medications and follow-up");
    expect(prompt).toContain("SECTION-SPECIFIC GUIDANCE");
  });

  it("uses custom systemPrompt when provided", () => {
    const labels = { notes: "Notes" };
    const prompt = buildTemplateSystemPrompt(
      TEMPLATE_WITH_CUSTOM_PROMPT,
      "sk",
      labels,
    );
    expect(prompt).toContain("Custom prompt for Slovak");
    expect(prompt).toContain('"notes": Notes');
    // Should NOT contain the default prompt
    expect(prompt).not.toContain("medical documentation assistant");
  });

  it("interpolates {{styleGuide}} with style guide content", () => {
    const labels = { notes: "Notes" };
    const prompt = buildTemplateSystemPrompt(
      TEMPLATE_WITH_STYLE_GUIDE,
      "en",
      labels,
    );
    expect(prompt).toContain("WRITING STYLE GUIDE");
    expect(prompt).toContain("telegraphic sentences");
  });

  it("renders Slovak language label for sk locale", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "sk",
      SECTION_LABELS,
    );
    expect(prompt).toContain("Slovak");
  });

  it("renders Czech language label for cs locale", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "cs",
      SECTION_LABELS,
    );
    expect(prompt).toContain("Czech");
  });

  it("includes grounding rule covering symptoms, findings, and diagnoses", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain("symptom, finding, diagnosis, procedure");
  });

  it("includes anti-severity-escalation instruction", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain("Do NOT upgrade diagnosis severity");
    expect(prompt).toContain("STEMI");
  });

  it("includes NO ASSUMPTION MODE rule forbidding unit fabrication", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain("NO ASSUMPTION MODE");
    expect(prompt).toContain("NEVER FABRICATE MISSING CLINICAL DIMENSIONS");
    // Concrete smoking counter-example from the failure analysis
    expect(prompt).toContain("fajčím 15");
    expect(prompt).toContain("15 cigariet denne");
    expect(prompt).toContain("fajčí 15 rokov");
    // Explicit "correctness > completeness" principle
    expect(prompt).toMatch(/correctness > completeness/i);
  });

  it("lists every clinical dimension that must not be fabricated", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toMatch(/frequency/i);
    expect(prompt).toMatch(/duration/i);
    expect(prompt).toMatch(/laterality/i);
    expect(prompt).toMatch(/dosage strength/i);
    expect(prompt).toMatch(/route of administration/i);
  });

  it("provides localized ambiguity markers for sk/cs/en", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain("(bližšie nešpecifikované)");
    expect(prompt).toContain("(blíže nespecifikováno)");
    expect(prompt).toContain("(not further specified)");
  });

  it("includes FACT VALUE FIDELITY rule for deterministic output", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain("FACT VALUE FIDELITY");
    expect(prompt).toContain("formatting task, not a creative writing task");
    expect(prompt).toContain("Do NOT rephrase, paraphrase, elaborate");
    expect(prompt).toContain("Do NOT merge multiple facts");
    expect(prompt).toContain("EXACT order they appear in the input");
  });

  it("includes source-priority hierarchy", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain("SOURCE PRIORITY");
    expect(prompt).toContain("Actual spoken transcript");
    expect(prompt).toContain("Doctor's additional notes");
    expect(prompt).toContain("Uploaded documents");
  });

  it("does NOT include TITLE RULES (title is generated separately)", () => {
    const prompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).not.toContain("TITLE RULES");
    expect(prompt).not.toContain('A "title" key');
    expect(prompt).toContain("Title is generated separately");
    expect(prompt).toContain("do NOT include");
  });
});

describe("buildFactBasedSystemPrompt", () => {
  it("includes FACT VALUE FIDELITY as the primary rule", () => {
    const prompt = buildFactBasedSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain("FACT VALUE FIDELITY");
    expect(prompt).toContain("formatting task, not a creative writing task");
    expect(prompt).toContain("Do NOT rephrase, paraphrase, elaborate");
  });

  it("does NOT include INSUFFICIENT CONTEXT CHECK", () => {
    const prompt = buildFactBasedSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).not.toContain("INSUFFICIENT CONTEXT CHECK");
    expect(prompt).not.toContain("insufficient_context");
  });

  it("does NOT include NO ASSUMPTION MODE verbose text", () => {
    const prompt = buildFactBasedSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).not.toContain("NO ASSUMPTION MODE");
    expect(prompt).not.toContain("Do NOT upgrade diagnosis severity");
  });

  it("does NOT include SOURCE PRIORITY hierarchy", () => {
    const prompt = buildFactBasedSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).not.toContain("SOURCE PRIORITY");
    expect(prompt).not.toContain("Actual spoken transcript");
  });

  it("does NOT include SECTION CONTENT ROUTING rules", () => {
    const prompt = buildFactBasedSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).not.toContain("SECTION CONTENT ROUTING");
    expect(prompt).not.toContain("HARD ROUTING RULES");
    expect(prompt).not.toContain("Lieková anamnéza");
  });

  it("does NOT include verbose TITLE RULES", () => {
    const prompt = buildFactBasedSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).not.toContain("TITLE RULES");
    expect(prompt).not.toContain("consistent with the primary diagnosis");
  });

  it("includes NEVER FABRICATE MISSING CLINICAL DIMENSIONS (condensed)", () => {
    const prompt = buildFactBasedSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain("NEVER FABRICATE MISSING CLINICAL DIMENSIONS");
    expect(prompt).toMatch(/correctness > completeness/i);
  });

  it("includes output language, formatting, and JSON format rules", () => {
    const prompt = buildFactBasedSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain("OUTPUT LANGUAGE");
    expect(prompt).toContain("English");
    expect(prompt).toContain("FORMATTING");
    expect(prompt).toContain("Return valid JSON");
    expect(prompt).not.toContain('"letter"');
    expect(prompt).not.toContain('"title"');
  });

  it("includes section IDs and labels", () => {
    const prompt = buildFactBasedSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    expect(prompt).toContain('"subjective"');
    expect(prompt).toContain('"objective"');
    expect(prompt).toContain('"assessment"');
    expect(prompt).toContain("Subjective");
  });

  it("includes section-specific guidance", () => {
    const labels: Record<string, string> = {
      history: "History",
      present_illness: "Present Illness",
      past_history: "Past History",
      plan: "Plan",
    };
    const contexts: Record<string, string> = {
      plan: "List medications and follow-up",
    };
    const prompt = buildFactBasedSystemPrompt(
      TEMPLATE_WITH_SUBSECTIONS,
      "en",
      labels,
      contexts,
    );
    expect(prompt).toContain("List medications and follow-up");
    expect(prompt).toContain("SECTION-SPECIFIC GUIDANCE");
  });

  it("uses custom systemPrompt when provided (bypasses optimization)", () => {
    const labels = { notes: "Notes" };
    const prompt = buildFactBasedSystemPrompt(
      TEMPLATE_WITH_CUSTOM_PROMPT,
      "sk",
      labels,
    );
    expect(prompt).toContain("Custom prompt for Slovak");
    expect(prompt).not.toContain("FACT VALUE FIDELITY");
  });

  it("includes style guide when template has one", () => {
    const labels = { notes: "Notes" };
    const prompt = buildFactBasedSystemPrompt(
      TEMPLATE_WITH_STYLE_GUIDE,
      "en",
      labels,
    );
    expect(prompt).toContain("WRITING STYLE GUIDE");
    expect(prompt).toContain("telegraphic sentences");
  });

  it("is significantly shorter than the full system prompt", () => {
    const factPrompt = buildFactBasedSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    const fullPrompt = buildTemplateSystemPrompt(
      SIMPLE_TEMPLATE,
      "en",
      SECTION_LABELS,
    );
    // Fact-based prompt should be at least 30% shorter
    expect(factPrompt.length).toBeLessThan(fullPrompt.length * 0.7);
  });
});

describe("title generation helpers", () => {
  const icd = (
    code: string,
    description: string,
    confidence: "high" | "medium" | "low" = "high",
  ): CandidateIcdCode => ({
    code,
    description,
    confidence,
    sourceConceptIds: [],
  });

  describe("TITLE_GENERATION_MODEL", () => {
    it("targets a Haiku 4.5 model for cheap, deterministic title calls", () => {
      expect(TITLE_GENERATION_MODEL).toBe("claude-haiku-4-5-20251001");
    });
  });

  describe("buildTitleSystemPrompt", () => {
    it("includes the language label", () => {
      expect(buildTitleSystemPrompt("en")).toContain("English");
      expect(buildTitleSystemPrompt("sk")).toContain("Slovak");
      expect(buildTitleSystemPrompt("cs")).toContain("Czech");
    });

    it("forbids inventing anatomical, severity, and laterality details", () => {
      const prompt = buildTitleSystemPrompt("sk");
      expect(prompt).toContain("anatomical localisation");
      expect(prompt).toContain("laterality");
      expect(prompt).toContain("severity qualifier");
    });

    it("enforces the 6-word limit and plain-text output", () => {
      const prompt = buildTitleSystemPrompt("en");
      expect(prompt).toContain("Maximum 6 words");
      expect(prompt).toContain("no JSON");
    });

    it("binds the title to the primary diagnosis and ignores R codes", () => {
      const prompt = buildTitleSystemPrompt("en");
      expect(prompt).toContain("FIRST (primary) diagnosis");
      expect(prompt).toContain("R00–R99");
    });

    it("spells out the STEMI counter-example to prevent regressions", () => {
      const prompt = buildTitleSystemPrompt("sk");
      expect(prompt).toContain("STEMI laterálnej steny");
      expect(prompt).toContain("Akútny transmurálny infarkt myokardu prednej");
    });
  });

  describe("buildTitleUserMessage", () => {
    it("lists each ICD code with its description on its own line", () => {
      const msg = buildTitleUserMessage([
        icd("I21.0", "Akútny transmurálny infarkt myokardu prednej steny"),
        icd("I10", "Primárna [esenciálna] artériová hypertenzia"),
        icd("R07.2", "Prekordiálna bolesť"),
      ]);
      expect(msg).toContain(
        "I21.0 Akútny transmurálny infarkt myokardu prednej steny",
      );
      expect(msg).toContain("I10 Primárna [esenciálna] artériová hypertenzia");
      expect(msg).toContain("R07.2 Prekordiálna bolesť");
    });

    it("marks the first ICD as the primary diagnosis", () => {
      const msg = buildTitleUserMessage([
        icd("J18.9", "Zápal pľúc, nešpecifikovaný"),
      ]);
      expect(msg).toContain("primary first");
    });

    it("instructs the model to output only the title", () => {
      const msg = buildTitleUserMessage([icd("I10", "Hypertenzia")]);
      expect(msg).toContain("Output only the title");
    });
  });

  describe("sanitizeGeneratedTitle", () => {
    it("trims whitespace", () => {
      expect(sanitizeGeneratedTitle("  Hypertenzia  ")).toBe("Hypertenzia");
    });

    it("strips straight and smart quotes", () => {
      expect(sanitizeGeneratedTitle('"Hypertenzia"')).toBe("Hypertenzia");
      expect(sanitizeGeneratedTitle("'Hypertenzia'")).toBe("Hypertenzia");
      expect(sanitizeGeneratedTitle("“Hypertenzia”")).toBe("Hypertenzia");
      expect(sanitizeGeneratedTitle("‘Hypertenzia’")).toBe("Hypertenzia");
    });

    it("strips trailing punctuation", () => {
      expect(sanitizeGeneratedTitle("Hypertenzia.")).toBe("Hypertenzia");
      expect(sanitizeGeneratedTitle("Akútny infarkt myokardu!")).toBe(
        "Akútny infarkt myokardu",
      );
    });

    it("collapses runs of whitespace", () => {
      expect(sanitizeGeneratedTitle("Akútny   infarkt\nmyokardu")).toBe(
        "Akútny infarkt myokardu",
      );
    });

    it("returns an empty string for empty input", () => {
      expect(sanitizeGeneratedTitle("")).toBe("");
      expect(sanitizeGeneratedTitle("   ")).toBe("");
    });

    it("handles a realistic primary-diagnosis title", () => {
      expect(
        sanitizeGeneratedTitle('  "Akútny infarkt myokardu prednej steny."  '),
      ).toBe("Akútny infarkt myokardu prednej steny");
    });
  });
});

describe("buildTemplateUserMessage", () => {
  it("includes numbered transcript chunks", () => {
    const msg = buildTemplateUserMessage(
      ["Patient complains of headache", "Pain started yesterday"],
      SIMPLE_TEMPLATE,
    );
    expect(msg).toContain("[Chunk 1]:");
    expect(msg).toContain("Patient complains of headache");
    expect(msg).toContain("[Chunk 2]:");
    expect(msg).toContain("Pain started yesterday");
  });

  it("includes doctor notes when provided", () => {
    const msg = buildTemplateUserMessage(
      ["Transcript chunk"],
      SIMPLE_TEMPLATE,
      "Patient appears anxious",
    );
    expect(msg).toContain("DOCTOR'S ADDITIONAL NOTES");
    expect(msg).toContain("Patient appears anxious");
  });

  it("includes file texts when provided", () => {
    const msg = buildTemplateUserMessage(
      ["Transcript chunk"],
      SIMPLE_TEMPLATE,
      undefined,
      [{ name: "lab-report.pdf", type: "application/pdf", text: "WBC: 12.0" }],
    );
    expect(msg).toContain("UPLOADED FILE CONTENTS");
    expect(msg).toContain("lab-report.pdf");
    expect(msg).toContain("WBC: 12.0");
  });

  it("includes all section IDs in the final instruction", () => {
    const msg = buildTemplateUserMessage(["chunk"], SIMPLE_TEMPLATE);
    expect(msg).toContain('"subjective"');
    expect(msg).toContain('"objective"');
    expect(msg).toContain('"assessment"');
    expect(msg).not.toContain('"letter"');
    expect(msg).not.toContain('"title"');
  });

  it("handles empty chunks array", () => {
    const msg = buildTemplateUserMessage(
      [],
      SIMPLE_TEMPLATE,
      "Doctor notes only",
    );
    expect(msg).not.toContain("[Chunk");
    expect(msg).toContain("Doctor notes only");
  });

  it("handles all inputs at once", () => {
    const msg = buildTemplateUserMessage(
      ["chunk1"],
      SIMPLE_TEMPLATE,
      "some notes",
      [{ name: "scan.jpg", type: "image/jpeg", text: "OCR text" }],
    );
    expect(msg).toContain("[Chunk 1]:");
    expect(msg).toContain("DOCTOR'S ADDITIONAL NOTES");
    expect(msg).toContain("UPLOADED FILE CONTENTS");
    expect(msg).toContain("Return valid JSON");
  });

  it("includes strict rules in the fact block header when facts are pre-assigned", async () => {
    const { emptyExtractedFacts } = await import("./clinical/fact-extraction");
    const validatedFacts = {
      ...emptyExtractedFacts(),
      symptoms: [
        {
          category: "symptoms" as const,
          value: "headache for 3 days",
          source: {
            type: "transcript" as const,
            sourceIndex: 0,
            evidence: "headache",
          },
        },
      ],
    };
    const sectionLabels = { subjective: "Subjective" };
    const msg = buildTemplateUserMessage(
      ["transcript chunk"],
      SIMPLE_TEMPLATE,
      undefined,
      undefined,
      validatedFacts,
      sectionLabels,
    );
    expect(msg).toContain("PRE-ASSIGNED TO SECTIONS");
    expect(msg).toContain("Preserve each fact's wording");
    expect(msg).toContain("EXACT order shown below");
    expect(msg).toContain("Do NOT merge facts");
    // Transcript should be excluded when facts are present
    expect(msg).not.toContain("[Chunk 1]:");
  });
});

describe("stripBulletMarkers", () => {
  it("strips dash bullet markers from lines", () => {
    const input = "- I10 Esenciálna hypertenzia\n- I48 Fibrilácia predsiení";
    const result = stripBulletMarkers(input);
    expect(result).toBe("I10 Esenciálna hypertenzia\nI48 Fibrilácia predsiení");
  });

  it("strips bullet (•) markers", () => {
    const input = "• Euthyrox 112 ug\n• Betaloc ZOK 25 mg";
    const result = stripBulletMarkers(input);
    expect(result).toBe("Euthyrox 112 ug\nBetaloc ZOK 25 mg");
  });

  it("strips en-dash and em-dash bullets", () => {
    const input = "– Item one\n— Item two";
    const result = stripBulletMarkers(input);
    expect(result).toBe("Item one\nItem two");
  });

  it("strips asterisk bullets", () => {
    const input = "* First\n* Second";
    const result = stripBulletMarkers(input);
    expect(result).toBe("First\nSecond");
  });

  it("preserves dashes in the middle of text", () => {
    const input = "Pacientka 14.4. prišla - pálenie nad srdcom";
    const result = stripBulletMarkers(input);
    expect(result).toBe(input);
  });

  it("preserves medication dosing format", () => {
    const input = "Rytmonorm 325 mg 1-0-1, Nolpaza 20 mg 1-0-0";
    const result = stripBulletMarkers(input);
    expect(result).toBe(input);
  });

  it("strips indented bullets", () => {
    const input = "  - Candibene\n  - Mukolytiká";
    const result = stripBulletMarkers(input);
    expect(result).toBe("Candibene\nMukolytiká");
  });

  it("returns empty string for empty input", () => {
    expect(stripBulletMarkers("")).toBe("");
  });

  it("handles mixed bullet and non-bullet lines", () => {
    const input = "Pacientka pri vedomí.\n- I10 Hypertenzia\nBez edémov.";
    const result = stripBulletMarkers(input);
    expect(result).toBe("Pacientka pri vedomí.\nI10 Hypertenzia\nBez edémov.");
  });
});
