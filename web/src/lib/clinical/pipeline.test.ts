import { describe, it, expect, vi } from "vitest";

// Mock env modules
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
  buildEnrichedSystemPrompt,
  buildPreRenderedIcdBlock,
} from "./pipeline";
import type { ClinicalAnalysis, CandidateIcdCode } from "./types";

// ── Fixtures ──

const BASE_PROMPT = "You are a medical documentation assistant.";

function makeAnalysis(
  overrides: Partial<ClinicalAnalysis> = {},
): ClinicalAnalysis {
  return {
    matchedConcepts: [],
    inferredSpecialty: "general_practice",
    problemClusters: [],
    candidateIcdCodes: [],
    mentionedMedications: [],
    usage: { inputTokens: 100, outputTokens: 50 },
    ...overrides,
  };
}

// ── Tests ──

describe("buildEnrichedSystemPrompt", () => {
  it("preserves the base prompt at the start", () => {
    const analysis = makeAnalysis();
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result.startsWith(BASE_PROMPT)).toBe(true);
  });

  it("includes specialty prompt addendum for general_practice", () => {
    const analysis = makeAnalysis({ inferredSpecialty: "general_practice" });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result).toContain("chief complaint");
  });

  it("includes specialty prompt addendum for cardiology", () => {
    const analysis = makeAnalysis({ inferredSpecialty: "cardiology" });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    // Cardiology pack should have cardiac-specific terminology
    expect(result).toContain("TERMINOLOGY");
  });

  it("includes pre-rendered ICD block with VERBATIM instruction", () => {
    const analysis = makeAnalysis({
      candidateIcdCodes: [
        {
          code: "I10",
          description: "Essential hypertension",
          confidence: "high",
          sourceConceptIds: ["hypertension"],
        },
        {
          code: "E11.9",
          description: "Type 2 diabetes mellitus",
          confidence: "medium",
          sourceConceptIds: ["diabetes"],
        },
      ],
    });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result).toContain("ICD-10 BLOCK (VERBATIM)");
    expect(result).toContain("- E11.9 Type 2 diabetes mellitus");
    expect(result).toContain("- I10 Essential hypertension");
    // Confidence labels should NOT appear (they're internal metadata)
    expect(result).not.toContain("(confidence:");
    // Codes should be sorted alphabetically (E before I)
    const e11Pos = result.indexOf("E11.9");
    const i10Pos = result.indexOf("I10 ");
    expect(e11Pos).toBeLessThan(i10Pos);
    // Must forbid narrative text in Záver section
    expect(result).toContain("MUST contain ONLY these ICD-10 code lines");
    expect(result).toContain("no additional narrative text");
  });

  it("includes explicit NO ICD instruction when no candidate codes", () => {
    const analysis = makeAnalysis({ candidateIcdCodes: [] });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result).not.toContain("ICD-10 BLOCK (VERBATIM)");
    expect(result).toContain("Do NOT include ANY ICD-10 codes");
    expect(result).toContain("Do NOT invent, guess, or add ICD codes");
  });

  it("includes matched concepts when present", () => {
    const analysis = makeAnalysis({
      matchedConcepts: [
        {
          conceptId: "hypertension",
          canonicalName: "Hypertension",
          confidence: "high",
          evidence: ["high blood pressure"],
        },
      ],
    });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result).toContain("IDENTIFIED CLINICAL CONCEPTS");
    expect(result).toContain("Hypertension");
  });

  it("omits concepts section when none matched", () => {
    const analysis = makeAnalysis({ matchedConcepts: [] });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result).not.toContain("IDENTIFIED CLINICAL CONCEPTS");
  });

  it("includes problem clusters when present", () => {
    const analysis = makeAnalysis({
      problemClusters: [
        {
          label: "Cardiovascular",
          conceptIds: ["hypertension", "dyslipidemia"],
        },
      ],
    });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result).toContain("PROBLEM CLUSTERS");
    expect(result).toContain("Cardiovascular");
    expect(result).toContain("hypertension, dyslipidemia");
  });

  it("omits problem clusters when empty", () => {
    const analysis = makeAnalysis({ problemClusters: [] });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result).not.toContain("PROBLEM CLUSTERS");
  });

  it("includes medication references when mentioned", () => {
    const analysis = makeAnalysis({
      mentionedMedications: ["Metformin"],
    });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "sk");
    expect(result).toContain("VERIFIED MEDICATIONS");
  });

  it("includes transcript-faithfulness rules for medications", () => {
    const analysis = makeAnalysis({
      mentionedMedications: ["Metformin"],
    });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result).toContain("Only include medications EXPLICITLY mentioned");
    expect(result).toContain(
      'Do NOT add medications that are "commonly prescribed"',
    );
  });

  it("omits medication section when none mentioned", () => {
    const analysis = makeAnalysis({ mentionedMedications: [] });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result).not.toContain("VERIFIED MEDICATIONS");
  });

  it("includes emphasized sections for the specialty", () => {
    const analysis = makeAnalysis({ inferredSpecialty: "general_practice" });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result).toContain("EMPHASIZED SECTIONS");
  });

  it("combines all enrichments together", () => {
    const analysis = makeAnalysis({
      inferredSpecialty: "internal_medicine",
      matchedConcepts: [
        {
          conceptId: "diabetes",
          canonicalName: "Diabetes Mellitus",
          confidence: "high",
          evidence: ["diabetes"],
        },
      ],
      candidateIcdCodes: [
        {
          code: "E11.9",
          description: "Type 2 DM",
          confidence: "high",
          sourceConceptIds: ["diabetes"],
        },
      ],
      problemClusters: [{ label: "Metabolic", conceptIds: ["diabetes"] }],
      mentionedMedications: ["Metformin"],
    });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    // Should have all sections
    expect(result).toContain(BASE_PROMPT);
    expect(result).toContain("TERMINOLOGY");
    expect(result).toContain("ICD-10 BLOCK (VERBATIM)");
    expect(result).toContain("IDENTIFIED CLINICAL CONCEPTS");
    expect(result).toContain("PROBLEM CLUSTERS");
    expect(result).toContain("VERIFIED MEDICATIONS");
  });

  // ── hasValidatedFacts flag behavior ──

  it("omits concepts when hasValidatedFacts is true", () => {
    const analysis = makeAnalysis({
      matchedConcepts: [
        {
          conceptId: "hypertension",
          canonicalName: "Hypertension",
          confidence: "high",
          evidence: ["high blood pressure"],
        },
      ],
    });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en", true);
    expect(result).not.toContain("IDENTIFIED CLINICAL CONCEPTS");
    expect(result).not.toContain("Hypertension");
  });

  it("omits problem clusters when hasValidatedFacts is true", () => {
    const analysis = makeAnalysis({
      problemClusters: [
        {
          label: "Cardiovascular",
          conceptIds: ["hypertension", "dyslipidemia"],
        },
      ],
    });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en", true);
    expect(result).not.toContain("PROBLEM CLUSTERS");
    expect(result).not.toContain("Cardiovascular");
  });

  it("still includes concepts when hasValidatedFacts is false", () => {
    const analysis = makeAnalysis({
      matchedConcepts: [
        {
          conceptId: "hypertension",
          canonicalName: "Hypertension",
          confidence: "high",
          evidence: ["high blood pressure"],
        },
      ],
    });
    const result = buildEnrichedSystemPrompt(
      BASE_PROMPT,
      analysis,
      "en",
      false,
    );
    expect(result).toContain("IDENTIFIED CLINICAL CONCEPTS");
  });

  it("still includes specialty pack and ICD block with hasValidatedFacts", () => {
    const analysis = makeAnalysis({
      inferredSpecialty: "cardiology",
      candidateIcdCodes: [
        {
          code: "I10",
          description: "Essential hypertension",
          confidence: "high",
          sourceConceptIds: ["hypertension"],
        },
      ],
    });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en", true);
    expect(result).toContain("TERMINOLOGY");
    expect(result).toContain("ICD-10 BLOCK (VERBATIM)");
  });

  it("omits medication block entirely when hasValidatedFacts is true", () => {
    const analysis = makeAnalysis({
      mentionedMedications: ["Metformin"],
    });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en", true);
    // Facts are the single source of truth — no separate medication block
    expect(result).not.toContain("VERIFIED MEDICATIONS");
    expect(result).not.toContain("MEDICATION");
    expect(result).not.toContain("Metformin");
  });

  it("uses full medication rules when hasValidatedFacts is false", () => {
    const analysis = makeAnalysis({
      mentionedMedications: ["Metformin"],
    });
    const result = buildEnrichedSystemPrompt(
      BASE_PROMPT,
      analysis,
      "en",
      false,
    );
    expect(result).toContain("VERIFIED MEDICATIONS FROM APPROVED LIST");
    expect(result).toContain("Only include medications EXPLICITLY mentioned");
  });
});

describe("buildPreRenderedIcdBlock", () => {
  function icd(
    code: string,
    description: string,
    confidence: "high" | "medium" | "low" = "high",
  ): CandidateIcdCode {
    return { code, description, confidence, sourceConceptIds: [] };
  }

  it("sorts candidates alphabetically by code", () => {
    const block = buildPreRenderedIcdBlock([
      icd("I10", "Essential hypertension"),
      icd("E11.9", "Type 2 DM"),
      icd("I21.2", "Acute MI"),
    ]);
    const lines = block.split("\n");
    expect(lines[0]).toBe("- E11.9 Type 2 DM");
    expect(lines[1]).toBe("- I10 Essential hypertension");
    expect(lines[2]).toBe("- I21.2 Acute MI");
  });

  it("excludes confidence labels", () => {
    const block = buildPreRenderedIcdBlock([
      icd("I10", "Essential hypertension", "high"),
      icd("E11.9", "Type 2 DM", "low"),
    ]);
    expect(block).not.toContain("high");
    expect(block).not.toContain("low");
    expect(block).not.toContain("confidence");
  });

  it("returns empty string for empty input", () => {
    expect(buildPreRenderedIcdBlock([])).toBe("");
  });

  it("does not mutate the input array", () => {
    const candidates = [
      icd("I10", "Essential hypertension"),
      icd("E11.9", "Type 2 DM"),
    ];
    const snapshot = JSON.parse(JSON.stringify(candidates));
    buildPreRenderedIcdBlock(candidates);
    expect(candidates).toEqual(snapshot);
  });

  it("produces identical output across invocations", () => {
    const candidates = [
      icd("I21.2", "Acute MI"),
      icd("I10", "Essential hypertension"),
      icd("E78.5", "Hyperlipidemia"),
    ];
    const a = buildPreRenderedIcdBlock(candidates);
    const b = buildPreRenderedIcdBlock(candidates);
    const c = buildPreRenderedIcdBlock(candidates);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
