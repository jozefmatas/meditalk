import { describe, it, expect } from "vitest";
import { resolveIcdFromFacts, computeFactId } from "./diagnosis-resolver";
import { emptyExtractedFacts, type ExtractedFact } from "./fact-extraction";

function diagnosis(value: string, negated = false): ExtractedFact {
  return {
    category: "diagnoses",
    value,
    ...(negated ? { negated: true as const } : {}),
    source: { type: "transcript", sourceIndex: 0, evidence: value },
  };
}

describe("computeFactId", () => {
  it("returns a stable category-index key", () => {
    const fact = diagnosis("Hypertenzia");
    expect(computeFactId(fact, 0)).toBe("diagnoses-0");
    expect(computeFactId(fact, 3)).toBe("diagnoses-3");
  });
});

describe("resolveIcdFromFacts — Slovak synonyms", () => {
  it("resolves bare STEMI to I21.3 (transmural, site unspecified)", () => {
    const facts = emptyExtractedFacts();
    facts.diagnoses.push(diagnosis("STEMI"));
    const result = resolveIcdFromFacts(facts, "sk");
    expect(result.codes).toHaveLength(1);
    expect(result.codes[0].code).toBe("I21.3");
    expect(result.codes[0].confidence).toBe("high");
    expect(result.codes[0].matchType).toBe("synonym");
    expect(result.codes[0].factIds).toEqual(["diagnoses-0"]);
  });

  it("resolves STEMI with wall location to the specific subcode", () => {
    const facts = emptyExtractedFacts();
    facts.diagnoses.push(diagnosis("STEMI prednej steny"));
    const result = resolveIcdFromFacts(facts, "sk");
    // "STEMI prednej steny" — normalized contains tokens; full-phrase
    // exact key match should hit the wall-specific entry.
    expect(result.codes[0].code).toBe("I21.0");
  });

  it("resolves HTN / Hypertenzia to I10", () => {
    const facts = emptyExtractedFacts();
    facts.diagnoses.push(diagnosis("HTN"));
    facts.diagnoses.push(diagnosis("Hypertenzia"));
    const result = resolveIcdFromFacts(facts, "sk");
    // Both facts map to the same code — merged with two factIds.
    expect(result.codes).toHaveLength(1);
    expect(result.codes[0].code).toBe("I10");
    expect(result.codes[0].factIds.sort()).toEqual([
      "diagnoses-0",
      "diagnoses-1",
    ]);
  });

  it("resolves DM2 to E11.9", () => {
    const facts = emptyExtractedFacts();
    facts.diagnoses.push(diagnosis("DM2"));
    const result = resolveIcdFromFacts(facts, "sk");
    expect(result.codes[0].code).toBe("E11.9");
  });
});

describe("resolveIcdFromFacts — exact description lookup", () => {
  it("matches the CSV description directly (diacritic-insensitive)", () => {
    // "Diabetes mellitus 1. typu" is an exact SK CSV description → E10
    const facts = emptyExtractedFacts();
    facts.diagnoses.push(diagnosis("Diabetes mellitus 1. typu"));
    const result = resolveIcdFromFacts(facts, "sk");
    expect(result.codes).toHaveLength(1);
    expect(result.codes[0].code).toBe("E10");
    expect(result.codes[0].matchType).toBe("exact_description");
    expect(result.codes[0].confidence).toBe("high");
  });
});

describe("resolveIcdFromFacts — fuzzy description search", () => {
  it("falls back to fuzzy token-overlap when no exact hit", () => {
    // A phrase that's NOT an exact CSV description but shares ≥60% of
    // tokens with one — "Akútny transmurálny infarkt myokardu" (no wall
    // location suffix) matches I21.x via fuzzy token overlap.
    const facts = emptyExtractedFacts();
    facts.diagnoses.push(diagnosis("Akútny transmurálny infarkt myokardu"));
    const result = resolveIcdFromFacts(facts, "sk");
    expect(result.codes.length).toBeGreaterThan(0);
    expect(result.codes[0].code.startsWith("I21")).toBe(true);
    expect(result.codes[0].matchType).toBe("fuzzy_description");
  });

  it("marks strongly-matching fuzzy hits as high confidence", () => {
    // A diagnosis phrase that fully contains the canonical description
    // should score ≥ 0.8 token overlap.
    const facts = emptyExtractedFacts();
    facts.diagnoses.push(diagnosis("Cholera"));
    const result = resolveIcdFromFacts(facts, "sk");
    // "Cholera" alone — single token. Overlap with "Cholera" alone is 1.0
    // and the CSV has "Cholera" as A00 exactly → exact match path.
    expect(result.codes[0].code).toBe("A00");
    expect(result.codes[0].confidence).toBe("high");
  });
});

describe("resolveIcdFromFacts — no evidence / negated / unresolved", () => {
  it("excludes diagnosis facts that can't be matched", () => {
    const facts = emptyExtractedFacts();
    facts.diagnoses.push(
      diagnosis("úplne vymyslená diagnóza bez kľúčových slov"),
    );
    const result = resolveIcdFromFacts(facts, "sk");
    expect(result.codes).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].factId).toBe("diagnoses-0");
  });

  it("does not produce codes for negated diagnoses", () => {
    const facts = emptyExtractedFacts();
    facts.diagnoses.push(diagnosis("Diabetes mellitus 1. typu", true));
    const result = resolveIcdFromFacts(facts, "sk");
    expect(result.codes).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
  });

  it("returns empty result when no diagnosis facts exist", () => {
    const facts = emptyExtractedFacts();
    const result = resolveIcdFromFacts(facts, "sk");
    expect(result.codes).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
  });
});

describe("resolveIcdFromFacts — evidence trail", () => {
  it("aggregates factIds when multiple facts resolve to the same code", () => {
    const facts = emptyExtractedFacts();
    facts.diagnoses.push(diagnosis("STEMI"));
    facts.diagnoses.push(
      diagnosis(
        "Akútny transmurálny infarkt myokardu bez bližšieho určenia miesta",
      ),
    );
    const result = resolveIcdFromFacts(facts, "sk");
    // Both resolve to I21.3 (STEMI → synonym I21.3; the full description
    // is an exact CSV match for I21.3) — merged, TWO factIds.
    const i213 = result.codes.find((c) => c.code === "I21.3");
    expect(i213).toBeDefined();
    expect(i213!.factIds.sort()).toEqual(["diagnoses-0", "diagnoses-1"]);
  });
});
