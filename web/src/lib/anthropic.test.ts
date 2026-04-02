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
  buildTemplateSystemPrompt,
  buildTemplateUserMessage,
  InsufficientContextError,
  NOT_STATED,
  GENERATION_MODELS,
  GENERATION_MODEL,
  MODEL_FALLBACK_DELAY,
} from "./anthropic";
import type { Template } from "./templates/types";

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
    expect(msg).toContain('"letter"');
    expect(msg).toContain('"title"');
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
});
