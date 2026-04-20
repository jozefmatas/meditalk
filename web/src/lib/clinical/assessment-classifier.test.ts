import { describe, it, expect } from "vitest";
import { classifyAssessment } from "./assessment-classifier";
import type { CandidateIcdCode } from "./types";
import { emptyExtractedFacts } from "./fact-extraction";
import type { ExtractedFact, ExtractedFacts } from "./fact-extraction";

/** Helper to create a candidate ICD code. */
function makeCandidate(
  code: string,
  description: string,
  confidence: "high" | "medium" | "low" = "high",
): CandidateIcdCode {
  return { code, description, confidence, sourceConceptIds: [code] };
}

/** Helper to create a fact in a specific category. */
function makeFact(category: string, value: string): ExtractedFact {
  return {
    category: category as ExtractedFact["category"],
    value,
    source: { type: "transcript", sourceIndex: 0, evidence: value },
  };
}

/** Helper to build facts with specific category entries. */
function buildFacts(entries: Record<string, string[]>): ExtractedFacts {
  const facts = emptyExtractedFacts();
  for (const [category, values] of Object.entries(entries)) {
    (facts as unknown as Record<string, unknown>)[category] = values.map((v) =>
      makeFact(category, v),
    );
  }
  return facts;
}

describe("classifyAssessment", () => {
  it("classifies diagnosis grounded by chiefComplaint as active_current", () => {
    const candidates = [
      makeCandidate("I21.0", "Akútny transmurálny infarkt myokardu"),
    ];
    const facts = buildFacts({
      chiefComplaint: ["bolesť na hrudníku, akútny infarkt myokardu"],
    });
    const result = classifyAssessment(candidates, facts);
    expect(result.activeCurrent).toHaveLength(1);
    expect(result.activeCurrent[0].code).toBe("I21.0");
  });

  it("classifies diagnosis grounded by diagnoses as active_current", () => {
    const candidates = [makeCandidate("I10", "Esenciálna hypertenzia")];
    const facts = buildFacts({
      diagnoses: ["esenciálna hypertenzia"],
    });
    const result = classifyAssessment(candidates, facts);
    expect(result.activeCurrent).toHaveLength(1);
  });

  it("classifies diagnosis grounded only by personalHistory as chronic_relevant", () => {
    const candidates = [makeCandidate("E11", "Diabetes mellitus 2. typu")];
    const facts = buildFacts({
      personalHistory: ["diabetes mellitus 2. typu od roku 2015"],
    });
    const result = classifyAssessment(candidates, facts);
    expect(result.chronicRelevant).toHaveLength(1);
    expect(result.chronicRelevant[0].code).toBe("E11");
    expect(result.activeCurrent).toHaveLength(0);
  });

  it("classifies diagnosis grounded only by medications as chronic_relevant", () => {
    const candidates = [makeCandidate("I10", "Esenciálna hypertenzia")];
    const facts = buildFacts({
      medications: ["Perindopril 4 mg — hypertenzia"],
    });
    const result = classifyAssessment(candidates, facts);
    expect(result.chronicRelevant).toHaveLength(1);
  });

  it("classifies ungrounded candidates as background_only", () => {
    const candidates = [
      makeCandidate("Z73", "Problémy spojené so životným štýlom"),
    ];
    const facts = buildFacts({
      diagnoses: ["akútny infarkt myokardu"],
    });
    const result = classifyAssessment(candidates, facts);
    expect(result.backgroundOnly).toHaveLength(1);
    expect(result.activeCurrent).toHaveLength(0);
    expect(result.chronicRelevant).toHaveLength(0);
  });

  it("caps active_current at 4, overflow goes to chronic_relevant", () => {
    // 6 active candidates
    const candidates = [
      makeCandidate("I21.0", "Infarkt myokardu"),
      makeCandidate("I10", "Hypertenzia"),
      makeCandidate("I48", "Fibrilácia predsiení"),
      makeCandidate("I25", "Ischemická choroba srdca"),
      makeCandidate("I50", "Srdcové zlyhávanie"),
      makeCandidate("E11", "Diabetes mellitus"),
    ];
    const facts = buildFacts({
      diagnoses: [
        "infarkt myokardu",
        "hypertenzia",
        "fibrilácia predsiení",
        "ischemická choroba srdca",
        "srdcové zlyhávanie",
        "diabetes mellitus",
      ],
    });
    const result = classifyAssessment(candidates, facts);
    expect(result.activeCurrent).toHaveLength(4);
    // Overflow should be in chronic
    expect(result.chronicRelevant).toHaveLength(2);
    expect(result.counts.active).toBe(4);
    expect(result.counts.chronic).toBe(2);
  });

  it("returns all as background_only when facts are empty", () => {
    const candidates = [
      makeCandidate("I10", "Hypertenzia"),
      makeCandidate("E11", "Diabetes"),
    ];
    const facts = emptyExtractedFacts();
    const result = classifyAssessment(candidates, facts);
    expect(result.backgroundOnly).toHaveLength(2);
    expect(result.activeCurrent).toHaveLength(0);
    expect(result.chronicRelevant).toHaveLength(0);
  });

  it("prefers active over chronic when grounded in both", () => {
    const candidates = [makeCandidate("I10", "Hypertenzia")];
    const facts = buildFacts({
      diagnoses: ["hypertenzia"],
      personalHistory: ["hypertenzia od roku 2010"],
    });
    const result = classifyAssessment(candidates, facts);
    // Should be active_current (diagnoses wins over personalHistory)
    expect(result.activeCurrent).toHaveLength(1);
    expect(result.chronicRelevant).toHaveLength(0);
  });

  it("handles empty candidates list", () => {
    const facts = buildFacts({ diagnoses: ["niečo"] });
    const result = classifyAssessment([], facts);
    expect(result.activeCurrent).toHaveLength(0);
    expect(result.chronicRelevant).toHaveLength(0);
    expect(result.backgroundOnly).toHaveLength(0);
    expect(result.counts.total).toBe(0);
  });

  it("grounds by literal ICD code in fact value", () => {
    const candidates = [makeCandidate("I10", "Esenciálna hypertenzia")];
    const facts = buildFacts({
      diagnoses: ["I10 – hypertenzia"],
    });
    const result = classifyAssessment(candidates, facts);
    expect(result.activeCurrent).toHaveLength(1);
  });
});
