import { describe, it, expect } from "vitest";
import {
  normalizeForMatch,
  evidenceAppearsInSource,
  validateFacts,
  countFacts,
  formatFactsForPrompt,
} from "./fact-validator";
import {
  emptyExtractedFacts,
  type ExtractedFacts,
  type FactExtractionInput,
} from "./fact-extraction";

describe("normalizeForMatch", () => {
  it("lowercases and strips diacritics", () => {
    expect(normalizeForMatch("Bolesť na hrudníku")).toBe("bolest na hrudniku");
  });

  it("collapses punctuation and whitespace", () => {
    expect(normalizeForMatch("  foo,   bar!!  baz. ")).toBe("foo bar baz");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(normalizeForMatch("  !!!  ")).toBe("");
  });

  it("preserves unicode letters outside Latin", () => {
    // Cyrillic preserved (letter category matches)
    expect(normalizeForMatch("Пациент")).toBe("пациент");
  });
});

describe("evidenceAppearsInSource", () => {
  it("matches exact substring (case/diacritic insensitive)", () => {
    expect(
      evidenceAppearsInSource(
        "bolesť na hrudníku",
        "Pacient má BOLEST na hrudniku od rana.",
      ),
    ).toBe(true);
  });

  it("matches across minor re-flow using token-order fallback", () => {
    // Evidence has extra filler words the source omits
    expect(
      evidenceAppearsInSource(
        "bolest v oblasti hrudnika",
        "Pacient udava bolest, ktora je lokalizovana v oblasti hrudnika.",
      ),
    ).toBe(true);
  });

  it("returns false when a required token is missing", () => {
    expect(
      evidenceAppearsInSource("bolest hlavy", "Pacient má bolest na hrudníku."),
    ).toBe(false);
  });

  it("returns false for empty evidence or source", () => {
    expect(evidenceAppearsInSource("", "some text")).toBe(false);
    expect(evidenceAppearsInSource("some text", "")).toBe(false);
    expect(evidenceAppearsInSource("", "")).toBe(false);
  });

  it("ignores very short (<3 char) tokens in fallback matching", () => {
    // "na" is too short to be a required token; 'cough' is present
    expect(
      evidenceAppearsInSource(
        "cough at night",
        "Patient has a persistent cough that worsens in the evening at night.",
      ),
    ).toBe(true);
  });
});

describe("validateFacts", () => {
  function factsWithOne(
    category: keyof Omit<ExtractedFacts, "usage">,
    value: string,
    sourceIndex = 0,
    evidence = value,
    type: "transcript" | "doctor_notes" | "file" = "transcript",
  ): ExtractedFacts {
    const f = emptyExtractedFacts();
    f[category].push({
      category,
      value,
      source: { type, sourceIndex, evidence },
    });
    return f;
  }

  it("keeps facts whose evidence appears in the referenced source", () => {
    const facts = factsWithOne("symptoms", "bolesť hlavy", 0, "bolesť hlavy");
    const input: FactExtractionInput = {
      chunks: ["Pacient udáva bolesť hlavy od rána."],
    };
    const result = validateFacts(facts, input);
    expect(result.validFacts.symptoms).toHaveLength(1);
    expect(result.removedFacts).toHaveLength(0);
    expect(result.counts.total).toBe(1);
  });

  it("removes facts whose evidence cannot be found in the source", () => {
    const facts = factsWithOne("symptoms", "cough", 0, "patient denies cough");
    const input: FactExtractionInput = {
      chunks: ["Patient reports chest pain only."],
    };
    const result = validateFacts(facts, input);
    expect(result.validFacts.symptoms).toHaveLength(0);
    expect(result.removedFacts).toHaveLength(1);
    expect(result.removedFacts[0].reason).toBe("evidence_not_in_source");
  });

  it("removes facts whose sourceIndex is out of range", () => {
    const facts = factsWithOne("symptoms", "cough", 5, "cough");
    const input: FactExtractionInput = { chunks: ["single chunk"] };
    const result = validateFacts(facts, input);
    expect(result.validFacts.symptoms).toHaveLength(0);
    expect(result.removedFacts[0].reason).toBe("source_index_out_of_range");
  });

  it("resolves doctor_notes source (must be index 0)", () => {
    const facts = factsWithOne(
      "symptoms",
      "fatigue",
      0,
      "complains of fatigue",
      "doctor_notes",
    );
    const input: FactExtractionInput = {
      chunks: [],
      doctorNotes: "Patient complains of fatigue over the last week.",
    };
    expect(validateFacts(facts, input).validFacts.symptoms).toHaveLength(1);
  });

  it("recovers a doctor_notes fact with wrong sourceIndex via cross-source fallback", () => {
    // LLM claims doctor_notes sourceIndex=1 (invalid), but the evidence IS
    // in the doctor notes at index 0. The fallback should find it and the
    // fact should be accepted with its source rewritten to index 0.
    const facts = factsWithOne(
      "symptoms",
      "fatigue",
      1,
      "complains of fatigue",
      "doctor_notes",
    );
    const input: FactExtractionInput = {
      chunks: [],
      doctorNotes: "Patient complains of fatigue.",
    };
    const result = validateFacts(facts, input);
    expect(result.validFacts.symptoms).toHaveLength(1);
    expect(result.validFacts.symptoms[0].source.sourceIndex).toBe(0);
    expect(result.removedFacts).toHaveLength(0);
    expect(result.counts.recoveredByFallback).toBe(1);
  });

  it("drops a doctor_notes fact whose evidence is absent from every source", () => {
    const facts = factsWithOne(
      "symptoms",
      "cough",
      1,
      "persistent cough",
      "doctor_notes",
    );
    const input: FactExtractionInput = {
      chunks: [],
      doctorNotes: "Patient complains of fatigue.",
    };
    const result = validateFacts(facts, input);
    expect(result.validFacts.symptoms).toHaveLength(0);
    expect(result.removedFacts).toHaveLength(1);
    expect(result.counts.recoveredByFallback).toBe(0);
  });

  it("recovers facts mislabeled as transcript when content is actually in a file (STEMI regression)", () => {
    // Real-world bug: an audio file Whisper-transcribed to text lives in
    // `files`, but the LLM labels its facts as `type: "transcript"` because
    // the content looks like dialog. The validator must recover these by
    // searching across all sources and rewrite the source reference.
    const facts = emptyExtractedFacts();
    facts.diagnoses.push({
      category: "diagnoses",
      value: "STEMI laterálnej steny ľavej komory",
      source: {
        type: "transcript",
        sourceIndex: 1,
        evidence: "STEMI laterálnej steny ľavej komory",
      },
    });
    facts.symptoms.push({
      category: "symptoms",
      value: "Typická bolesť, vyžarovanie do ľavej ruky",
      source: {
        type: "transcript",
        sourceIndex: 2,
        evidence: "typická bolesť s vyžarovaním do ľavej ruky",
      },
    });
    const input: FactExtractionInput = {
      chunks: [], // no transcript chunks at all!
      files: [
        {
          name: "zachranka.jpg",
          type: "image/jpeg",
          text: "EKG obraz, typická bolesť s vyžarovaním do ľavej ruky, podozrenie na STEMI laterálnej steny ľavej komory.",
        },
      ],
    };
    const result = validateFacts(facts, input);
    expect(result.validFacts.diagnoses).toHaveLength(1);
    expect(result.validFacts.symptoms).toHaveLength(1);
    expect(result.validFacts.diagnoses[0].source.type).toBe("file");
    expect(result.validFacts.diagnoses[0].source.sourceIndex).toBe(0);
    expect(result.validFacts.symptoms[0].source.type).toBe("file");
    expect(result.counts.recoveredByFallback).toBe(2);
    expect(result.removedFacts).toHaveLength(0);
  });

  it("reports zero recoveredByFallback when claimed sources are correct", () => {
    const facts = factsWithOne("symptoms", "bolesť", 0, "bolesť");
    const input: FactExtractionInput = { chunks: ["Pacient udáva bolesť."] };
    const result = validateFacts(facts, input);
    expect(result.counts.recoveredByFallback).toBe(0);
    expect(result.validFacts.symptoms).toHaveLength(1);
  });

  it("resolves file source by index and checks evidence against file text", () => {
    const facts = factsWithOne(
      "measurements",
      "Hb 14.2 g/dL",
      0,
      "Hb 14.2",
      "file",
    );
    const input: FactExtractionInput = {
      chunks: [],
      files: [
        {
          name: "lab.pdf",
          type: "application/pdf",
          text: "Results: Hb 14.2 g/dL, WBC 6.1",
        },
      ],
    };
    expect(validateFacts(facts, input).validFacts.measurements).toHaveLength(1);
  });

  it("deduplicates facts with same normalized value within a category", () => {
    const facts = emptyExtractedFacts();
    facts.symptoms.push({
      category: "symptoms",
      value: "Bolesť hlavy",
      source: { type: "transcript", sourceIndex: 0, evidence: "bolesť hlavy" },
    });
    facts.symptoms.push({
      category: "symptoms",
      value: "bolest hlavy",
      source: { type: "transcript", sourceIndex: 0, evidence: "bolest hlavy" },
    });
    const input: FactExtractionInput = {
      chunks: ["Pacient udáva bolesť hlavy už druhý deň."],
    };
    const result = validateFacts(facts, input);
    expect(result.validFacts.symptoms).toHaveLength(1);
    expect(result.removedFacts).toHaveLength(1);
    expect(result.removedFacts[0].reason).toBe("duplicate");
  });

  it("drops facts with empty value", () => {
    const facts = emptyExtractedFacts();
    facts.symptoms.push({
      category: "symptoms",
      value: "   ",
      source: { type: "transcript", sourceIndex: 0, evidence: "anything" },
    });
    const input: FactExtractionInput = { chunks: ["anything here"] };
    const result = validateFacts(facts, input);
    expect(result.validFacts.symptoms).toHaveLength(0);
    expect(result.removedFacts[0].reason).toBe("empty_value");
  });

  it("never mutates the input facts object", () => {
    const facts = factsWithOne("symptoms", "cough", 0, "cough");
    const input: FactExtractionInput = { chunks: ["no chest pain"] };
    const originalLength = facts.symptoms.length;
    const result = validateFacts(facts, input);
    expect(facts.symptoms).toHaveLength(originalLength); // still has the original
    expect(result.validFacts.symptoms).toHaveLength(0); // but the result dropped it
  });

  it("preserves token usage on the validFacts output", () => {
    const facts = emptyExtractedFacts();
    facts.usage = { inputTokens: 100, outputTokens: 50 };
    const result = validateFacts(facts, { chunks: [] });
    expect(result.validFacts.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it("emits a warning for medications not in the approved list (sk)", () => {
    const facts = factsWithOne(
      "medications",
      "ObviouslyFakeNotARealDrug 500mg",
      0,
      "ObviouslyFakeNotARealDrug",
    );
    const input: FactExtractionInput = {
      chunks: ["pacient berie ObviouslyFakeNotARealDrug"],
    };
    const result = validateFacts(facts, input, { locale: "sk" });
    expect(result.validFacts.medications).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("ObviouslyFakeNotARealDrug");
  });
});

describe("countFacts", () => {
  it("sums across all categories", () => {
    const f = emptyExtractedFacts();
    f.symptoms.push({
      category: "symptoms",
      value: "a",
      source: { type: "transcript", sourceIndex: 0, evidence: "a" },
    });
    f.diagnoses.push({
      category: "diagnoses",
      value: "b",
      source: { type: "transcript", sourceIndex: 0, evidence: "b" },
    });
    expect(countFacts(f)).toBe(2);
  });

  it("returns 0 for an empty set", () => {
    expect(countFacts(emptyExtractedFacts())).toBe(0);
  });
});

describe("formatFactsForPrompt", () => {
  it("groups facts by category and renders bullets", () => {
    const f = emptyExtractedFacts();
    f.symptoms.push({
      category: "symptoms",
      value: "bolesť hlavy",
      source: { type: "transcript", sourceIndex: 0, evidence: "bolesť hlavy" },
    });
    f.diagnoses.push({
      category: "diagnoses",
      value: "migraine",
      source: { type: "transcript", sourceIndex: 0, evidence: "migraine" },
    });
    const out = formatFactsForPrompt(f);
    expect(out).toContain("Symptoms:");
    expect(out).toContain("- bolesť hlavy");
    expect(out).toContain("Diagnoses:");
    expect(out).toContain("- migraine");
  });

  it("skips empty categories", () => {
    const f = emptyExtractedFacts();
    f.symptoms.push({
      category: "symptoms",
      value: "cough",
      source: { type: "transcript", sourceIndex: 0, evidence: "cough" },
    });
    const out = formatFactsForPrompt(f);
    expect(out).toContain("Symptoms:");
    expect(out).not.toContain("Diagnoses:");
    expect(out).not.toContain("Demographics:");
  });
});
