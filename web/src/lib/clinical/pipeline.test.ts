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

import { buildEnrichedSystemPrompt } from "./pipeline";
import type { ClinicalAnalysis } from "./types";

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

  it("includes candidate ICD codes when present", () => {
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
    expect(result).toContain("CANDIDATE ICD-10 CODES");
    expect(result).toContain("I10");
    expect(result).toContain("Essential hypertension");
    expect(result).toContain("E11.9");
    expect(result).toContain("Type 2 diabetes mellitus");
    expect(result).toContain("high");
    expect(result).toContain("medium");
  });

  it("omits ICD section when no candidate codes", () => {
    const analysis = makeAnalysis({ candidateIcdCodes: [] });
    const result = buildEnrichedSystemPrompt(BASE_PROMPT, analysis, "en");
    expect(result).not.toContain("CANDIDATE ICD-10 CODES");
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
    expect(result).toContain("CANDIDATE ICD-10 CODES");
    expect(result).toContain("IDENTIFIED CLINICAL CONCEPTS");
    expect(result).toContain("PROBLEM CLUSTERS");
    expect(result).toContain("VERIFIED MEDICATIONS");
  });
});
