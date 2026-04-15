import { describe, it, expect } from "vitest";
import { resolveFacts, CORRECTION_PHRASES } from "./fact-resolver";
import type {
  ExtractedFact,
  ExtractedFacts,
  FactCategory,
  FactExtractionInput,
} from "./fact-extraction";
import { emptyExtractedFacts } from "./fact-extraction";

/**
 * Shorthand for constructing a fact with only the fields we care about
 * in these tests. Category defaults to `diagnoses`; override as needed.
 */
function fact(
  value: string,
  evidence: string,
  options: {
    category?: FactCategory;
    type?: "transcript" | "doctor_notes" | "file";
    sourceIndex?: number;
  } = {},
): ExtractedFact {
  return {
    category: options.category ?? "diagnoses",
    value,
    source: {
      type: options.type ?? "transcript",
      sourceIndex: options.sourceIndex ?? 0,
      evidence,
    },
  };
}

/** Build an ExtractedFacts bundle from a flat list of facts. */
function bundle(facts: ExtractedFact[]): ExtractedFacts {
  const out = emptyExtractedFacts();
  for (const f of facts) out[f.category].push(f);
  return out;
}

describe("CORRECTION_PHRASES", () => {
  it("has entries for every supported locale", () => {
    expect(CORRECTION_PHRASES.sk.length).toBeGreaterThan(0);
    expect(CORRECTION_PHRASES.cs.length).toBeGreaterThan(0);
    expect(CORRECTION_PHRASES.en.length).toBeGreaterThan(0);
  });

  it("includes the canonical MI→stroke correction triggers", () => {
    expect(CORRECTION_PHRASES.sk).toContain("vlastne");
    expect(CORRECTION_PHRASES.cs).toContain("vlastne");
    expect(CORRECTION_PHRASES.en).toContain("actually");
    expect(CORRECTION_PHRASES.en).toContain("i mean");
  });
});

describe("resolveFacts — no-op cases", () => {
  it("returns empty resolutions when there is nothing to resolve", () => {
    const input: FactExtractionInput = {
      chunks: ["Patient has chest pain."],
    };
    const facts = bundle([fact("chest pain", "chest pain")]);
    const result = resolveFacts(facts, input, "en");
    expect(result.resolutions).toEqual([]);
    expect(result.counts.total).toBe(0);
    expect(result.resolvedFacts.diagnoses).toHaveLength(1);
  });

  it("does not mutate the input facts", () => {
    const input: FactExtractionInput = {
      chunks: ["Patient has chest pain."],
    };
    const original = bundle([fact("chest pain", "chest pain")]);
    const snapshot = JSON.parse(JSON.stringify(original));
    resolveFacts(original, input, "en");
    expect(original).toEqual(snapshot);
  });

  it("preserves usage token counts", () => {
    const input: FactExtractionInput = { chunks: ["x"] };
    const facts = emptyExtractedFacts();
    facts.usage = { inputTokens: 42, outputTokens: 17 };
    const result = resolveFacts(facts, input, "en");
    expect(result.resolvedFacts.usage).toEqual({
      inputTokens: 42,
      outputTokens: 17,
    });
  });
});

describe("resolveFacts — correction-phrase drop (English)", () => {
  it("drops a fact whose evidence is immediately followed by 'actually'", () => {
    const input: FactExtractionInput = {
      chunks: ["His father died of MI, actually I mean stroke, at age 60."],
    };
    const facts = bundle([
      fact("father died of MI", "father died of MI"),
      fact("father died of stroke", "I mean stroke"),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.diagnoses.map((f) => f.value)).toEqual([
      "father died of stroke",
    ]);
  });

  it("drops a fact whose evidence is followed by 'sorry'", () => {
    const input: FactExtractionInput = {
      chunks: ["He broke 1 rib, sorry, 2 ribs on his left side."],
    };
    const facts = bundle([
      fact("1 broken rib", "broke 1 rib"),
      fact("2 broken ribs", "2 ribs on his left"),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.diagnoses.map((f) => f.value)).toEqual([
      "2 broken ribs",
    ]);
  });

  it("does not drop a fact when the correction phrase is far away", () => {
    // "actually" appears well past the 120-char window
    const input: FactExtractionInput = {
      chunks: [
        "Patient had myocardial infarction. " +
          "A very long sentence follows that describes many unrelated things " +
          "about the patient's lifestyle, habits, exercise, diet, and work. " +
          "Actually, the dose was different.",
      ],
    };
    const facts = bundle([
      fact("myocardial infarction", "had myocardial infarction"),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(0);
    expect(result.resolvedFacts.diagnoses).toHaveLength(1);
  });

  it("respects word boundaries — 'factually' is not a correction", () => {
    const input: FactExtractionInput = {
      chunks: ["Patient has chest pain. Factually correct."],
    };
    const facts = bundle([fact("chest pain", "chest pain")]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(0);
    expect(result.resolvedFacts.diagnoses).toHaveLength(1);
  });
});

describe("resolveFacts — correction-phrase drop (Slovak)", () => {
  it("drops a fact whose evidence is followed by 'vlastne'", () => {
    const input: FactExtractionInput = {
      chunks: [
        "Otec zomrel na infarkt, vlastne na mozgovú príhodu, v 60 rokoch.",
      ],
    };
    const facts = bundle([
      fact("otec zomrel na infarkt", "Otec zomrel na infarkt"),
      fact("otec zomrel na mozgovú príhodu", "na mozgovú príhodu"),
    ]);
    const result = resolveFacts(facts, input, "sk");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.diagnoses.map((f) => f.value)).toEqual([
      "otec zomrel na mozgovú príhodu",
    ]);
  });

  it("drops a fact followed by 'pardon'", () => {
    const input: FactExtractionInput = {
      chunks: ["Predpísal som Aspirin, pardon, Brilique 90mg."],
    };
    const facts = bundle([
      fact("Aspirin", "Aspirin", { category: "medications" }),
      fact("Brilique 90mg", "Brilique 90mg", { category: "medications" }),
    ]);
    const result = resolveFacts(facts, input, "sk");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.medications.map((f) => f.value)).toEqual([
      "Brilique 90mg",
    ]);
  });
});

describe("resolveFacts — correction-phrase drop (Czech)", () => {
  it("drops a fact followed by 'vlastně'", () => {
    const input: FactExtractionInput = {
      chunks: ["Otec zemřel na infarkt, vlastně na mrtvici, v 60 letech."],
    };
    const facts = bundle([
      fact("otec zemřel na infarkt", "Otec zemřel na infarkt"),
      fact("otec zemřel na mrtvici", "na mrtvici"),
    ]);
    const result = resolveFacts(facts, input, "cs");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.diagnoses.map((f) => f.value)).toEqual([
      "otec zemřel na mrtvici",
    ]);
  });
});

describe("resolveFacts — locale-agnostic punctuation-bracketed negation", () => {
  // Structural correction pattern:  "<fact A>, <short negation>, <fact B>"
  // is recognised across every locale without any per-locale wiring.

  it("drops the MI fact when followed by ', nie,' in Slovak (RA hallucination repro)", () => {
    // Exact repro of the RA hallucination bug reported by the user.
    const input: FactExtractionInput = {
      chunks: [
        "Otec zomrel v 68. roku života na infarkt, nie, na mozgovú mŕtvicu.",
      ],
    };
    const facts = bundle([
      fact("otec zomrel infarkt", "na infarkt", { category: "familyHistory" }),
      fact("otec zomrel mozgová mŕtvica", "na mozgovú mŕtvicu", {
        category: "familyHistory",
      }),
    ]);
    const result = resolveFacts(facts, input, "sk");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.familyHistory.map((f) => f.value)).toEqual([
      "otec zomrel mozgová mŕtvica",
    ]);
  });

  it("drops the earlier fact when followed by ', ne,' in Czech", () => {
    const input: FactExtractionInput = {
      chunks: ["Otec zemřel na infarkt, ne, na mrtvici."],
    };
    const facts = bundle([
      fact("otec zemřel infarkt", "na infarkt", { category: "familyHistory" }),
      fact("otec zemřel mrtvice", "na mrtvici", { category: "familyHistory" }),
    ]);
    const result = resolveFacts(facts, input, "cs");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.familyHistory.map((f) => f.value)).toEqual([
      "otec zemřel mrtvice",
    ]);
  });

  it("does NOT drop facts when English ', no,' appears (removed from regex — Slovak 'no' = filler)", () => {
    // "no" was removed from RAW_CORRECTION_REGEX because Slovak "no"
    // means "well/so" and caused false positive drops. English "no" as
    // a correction is covered by phrases "no wait" / "wait no" instead.
    const input: FactExtractionInput = {
      chunks: ["Father died of MI, no, of a stroke."],
    };
    const facts = bundle([
      fact("father died of MI", "died of MI", { category: "familyHistory" }),
      fact("father died of stroke", "of a stroke", {
        category: "familyHistory",
      }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(0);
    expect(result.resolvedFacts.familyHistory).toHaveLength(2);
  });

  it("works with an em-dash bracketing the negation (generic punctuation)", () => {
    const input: FactExtractionInput = {
      chunks: ["Bolesť hlavy — nie — dýchavica."],
    };
    const facts = bundle([
      fact("bolesť hlavy", "Bolesť hlavy", { category: "symptoms" }),
      fact("dýchavica", "dýchavica", { category: "symptoms" }),
    ]);
    const result = resolveFacts(facts, input, "sk");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.symptoms.map((f) => f.value)).toEqual([
      "dýchavica",
    ]);
  });

  it("works for a locale we don't officially support — German 'nein'", () => {
    // Regression test for the locale-agnostic design: the pattern is
    // structural, so a locale beyond sk/cs/en is still handled correctly.
    const input: FactExtractionInput = {
      chunks: ["Vater starb an Infarkt, nein, an einem Schlaganfall."],
    };
    const facts = bundle([
      fact("vater starb an infarkt", "an Infarkt", {
        category: "familyHistory",
      }),
      fact("vater starb an schlaganfall", "an einem Schlaganfall", {
        category: "familyHistory",
      }),
    ]);
    // We pass `en` since the locale param doesn't need to match the text
    // for the raw-text detector (the phrase list may be wrong but the
    // regex path is language-agnostic).
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.familyHistory.map((f) => f.value)).toEqual([
      "vater starb an schlaganfall",
    ]);
  });

  it("does NOT drop facts when Slovak 'no' (= well/so) appears as filler", () => {
    // Slovak "no" means "well/so" — it's a common filler word in clinical
    // speech: "bolesti na hrudníku, no, začali pred 2 hodinami" means
    // "chest pain, well, started 2 hours ago." This must NOT trigger
    // the correction detector.
    const input: FactExtractionInput = {
      chunks: ["Pacient má bolesti na hrudníku, no, začali pred 2 hodinami."],
    };
    const facts = bundle([
      fact("bolesti na hrudníku", "bolesti na hrudníku", {
        category: "symptoms",
      }),
    ]);
    const result = resolveFacts(facts, input, "sk");
    expect(result.counts.correctionDrops).toBe(0);
    expect(result.resolvedFacts.symptoms).toHaveLength(1);
  });

  it("does NOT drop facts when 'nie' is an in-sentence negation (no comma bracket)", () => {
    // The speaker says "pacient nie je unavený" — "nie" is part of the
    // negation verb phrase, not a correction. Must NOT drop the fact.
    const input: FactExtractionInput = {
      chunks: ["Pacient má bolesť hlavy. Pacient nie je unavený."],
    };
    const facts = bundle([
      fact("bolesť hlavy", "bolesť hlavy", { category: "symptoms" }),
    ]);
    const result = resolveFacts(facts, input, "sk");
    expect(result.counts.correctionDrops).toBe(0);
    expect(result.resolvedFacts.symptoms).toHaveLength(1);
  });

  it("does NOT drop facts when 'no' is a leading negation without bracketing commas", () => {
    // English: "chest pain. No fever." — "No" starts a new sentence and
    // is not bracketed by commas on both sides. Must NOT drop the fact.
    const input: FactExtractionInput = {
      chunks: ["Chest pain. No fever."],
    };
    const facts = bundle([
      fact("chest pain", "Chest pain", { category: "symptoms" }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(0);
    expect(result.resolvedFacts.symptoms).toHaveLength(1);
  });

  it("does NOT drop when a qualifier like ', not severe,' appears after the fact", () => {
    // Regression: "pain, not severe, persistent" has a comma-bracketed
    // qualifier. "not" is intentionally excluded from the regex exactly
    // to avoid this false positive.
    const input: FactExtractionInput = {
      chunks: ["Abdominal pain, not severe, persistent for 3 days."],
    };
    const facts = bundle([
      fact("abdominal pain", "Abdominal pain", { category: "symptoms" }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(0);
    expect(result.resolvedFacts.symptoms).toHaveLength(1);
  });

  it("is case-insensitive for the negation token", () => {
    const input: FactExtractionInput = {
      chunks: ["Otec zomrel na infarkt, NIE, na mozgovú mŕtvicu."],
    };
    const facts = bundle([
      fact("otec zomrel infarkt", "na infarkt", { category: "familyHistory" }),
      fact("otec zomrel mozgová mŕtvica", "na mozgovú mŕtvicu", {
        category: "familyHistory",
      }),
    ]);
    const result = resolveFacts(facts, input, "sk");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.familyHistory.map((f) => f.value)).toEqual([
      "otec zomrel mozgová mŕtvica",
    ]);
  });
});

describe("resolveFacts — time-series preservation (no numeric collapse)", () => {
  // Regression tests for the bug where a vitals table with multiple BP
  // readings over time got collapsed to a single reading. The resolver
  // must NOT drop numerically different facts just because they share a
  // clinical key — that's a time series, not a correction.

  it("keeps all four BP readings from a vitals table (regression)", () => {
    // Exact repro of the EMS vitals table bug. The doctor recorded BP
    // at 4 timestamps. The old resolver collapsed them to just the last
    // one because they all shared a digit-stripped clinical key.
    const input: FactExtractionInput = {
      chunks: [
        "VF 14:02 14:31 14:58 15:12\n" +
          "TK Torr 150/80 145/80 145/80 143/80\n" +
          "SF min 68 67 68 78\n",
      ],
    };
    const facts = bundle([
      fact("TK 150/80 mmHg (14:02)", "150/80", { category: "measurements" }),
      fact("TK 145/80 mmHg (14:31)", "145/80", { category: "measurements" }),
      fact("TK 145/80 mmHg (14:58)", "145/80", { category: "measurements" }),
      fact("TK 143/80 mmHg (15:12)", "143/80", { category: "measurements" }),
    ]);
    const result = resolveFacts(facts, input, "sk");
    expect(result.counts.total).toBe(0);
    expect(result.resolvedFacts.measurements).toHaveLength(4);
    expect(result.resolvedFacts.measurements.map((f) => f.value)).toEqual([
      "TK 150/80 mmHg (14:02)",
      "TK 145/80 mmHg (14:31)",
      "TK 145/80 mmHg (14:58)",
      "TK 143/80 mmHg (15:12)",
    ]);
  });

  it("keeps two BP readings across separate sentences with no correction signal", () => {
    // This used to be collapsed to just "BP 160" by the Stage 2
    // numeric-duplicate rule. Both readings are legitimate and must
    // survive — either could be a pre/post measurement, or progression.
    const input: FactExtractionInput = {
      chunks: ["BP 150/90 early in visit. BP 160/95 at end of visit."],
    };
    const facts = bundle([
      fact("BP 150/90", "BP 150/90 early", { category: "measurements" }),
      fact("BP 160/95", "BP 160/95 at end", { category: "measurements" }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.total).toBe(0);
    expect(result.resolvedFacts.measurements.map((f) => f.value)).toEqual([
      "BP 150/90",
      "BP 160/95",
    ]);
  });

  it("keeps the progression '1 broken rib' → '2 broken ribs' when no correction phrase is present", () => {
    // Clinical evolution: X-ray showed 1 rib fracture, CT later showed
    // 2. Both are real findings and should be preserved. Only a
    // correction phrase or bracketed negation should ever drop one.
    const input: FactExtractionInput = {
      chunks: [
        "Initial X-ray showed 1 broken rib. Follow-up CT showed 2 broken ribs.",
      ],
    };
    const facts = bundle([
      fact("1 broken rib", "1 broken rib", { category: "findings" }),
      fact("2 broken ribs", "2 broken ribs", { category: "findings" }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.total).toBe(0);
    expect(result.resolvedFacts.findings).toHaveLength(2);
  });

  it("still drops '1 rib, sorry, 2 ribs' via the correction-phrase path", () => {
    // Sanity check: removing the numeric-duplicate rule must NOT
    // regress the correction-phrase rule. "sorry" between the two
    // mentions is still a correction signal, so the first drops.
    const input: FactExtractionInput = {
      chunks: ["He broke 1 rib, sorry, 2 ribs on his left side."],
    };
    const facts = bundle([
      fact("1 broken rib", "broke 1 rib", { category: "findings" }),
      fact("2 broken ribs", "2 ribs on his left", { category: "findings" }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.findings.map((f) => f.value)).toEqual([
      "2 broken ribs",
    ]);
  });

  it("does not merge two unrelated measurements with different clinical entities", () => {
    const input: FactExtractionInput = {
      chunks: ["BP 150/90 and HR 80 bpm."],
    };
    const facts = bundle([
      fact("BP 150/90", "BP 150/90", { category: "measurements" }),
      fact("HR 80 bpm", "HR 80 bpm", { category: "measurements" }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.total).toBe(0);
    expect(result.resolvedFacts.measurements).toHaveLength(2);
  });
});

describe("resolveFacts — multi-category isolation", () => {
  it("resolves corrections per-category without bleeding across categories", () => {
    const input: FactExtractionInput = {
      chunks: [
        "Has chest pain, actually it is mainly shortness of breath. " +
          "Prescribed Aspirin.",
      ],
    };
    const facts = bundle([
      fact("chest pain", "chest pain", { category: "symptoms" }),
      fact("shortness of breath", "mainly shortness of breath", {
        category: "symptoms",
      }),
      fact("Aspirin", "Aspirin", { category: "medications" }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.symptoms.map((f) => f.value)).toEqual([
      "shortness of breath",
    ]);
    expect(result.resolvedFacts.medications.map((f) => f.value)).toEqual([
      "Aspirin",
    ]);
  });
});

describe("resolveFacts — source-type handling", () => {
  it("resolves facts sourced from doctor_notes", () => {
    const input: FactExtractionInput = {
      chunks: [],
      doctorNotes: "Father died of MI, actually stroke.",
    };
    const facts = bundle([
      fact("father died of MI", "Father died of MI", {
        type: "doctor_notes",
      }),
      fact("father died of stroke", "actually stroke", {
        type: "doctor_notes",
      }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.diagnoses.map((f) => f.value)).toEqual([
      "father died of stroke",
    ]);
  });

  it("resolves facts sourced from uploaded files", () => {
    const input: FactExtractionInput = {
      chunks: [],
      files: [
        {
          name: "referral.pdf",
          type: "application/pdf",
          text: "Suspected STEMI, actually non-STEMI on repeat troponin.",
        },
      ],
    };
    const facts = bundle([
      fact("STEMI", "Suspected STEMI", { type: "file", sourceIndex: 0 }),
      fact("non-STEMI", "actually non-STEMI", {
        type: "file",
        sourceIndex: 0,
      }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.diagnoses.map((f) => f.value)).toEqual([
      "non-STEMI",
    ]);
  });

  it("falls back to cross-source lookup when the claimed source is wrong", () => {
    // Fact claims to be from chunk index 1, but the evidence only exists
    // in chunk index 0. Resolver should still find the correction via
    // the fallback path.
    const input: FactExtractionInput = {
      chunks: ["alpha fact, actually beta fact"],
    };
    const facts = bundle([
      fact("alpha fact", "alpha fact", { sourceIndex: 1 }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(1);
    expect(result.resolvedFacts.diagnoses).toHaveLength(0);
  });
});

describe("resolveFacts — telemetry", () => {
  it("records resolution events with reason and category", () => {
    const input: FactExtractionInput = {
      chunks: ["He had MI, actually stroke."],
    };
    const facts = bundle([
      fact("MI", "He had MI"),
      fact("stroke", "actually stroke"),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0].reason).toBe("correction_phrase");
    expect(result.resolutions[0].category).toBe("diagnoses");
    expect(result.resolutions[0].dropped.value).toBe("MI");
  });

  it("records no events when there are no corrections", () => {
    // Two BP readings with no correction signal between them — the
    // resolver must pass both through without telemetry events.
    const input: FactExtractionInput = {
      chunks: ["BP 150/90 early. BP 160/95 end."],
    };
    const facts = bundle([
      fact("BP 150/90", "BP 150/90 early", { category: "measurements" }),
      fact("BP 160/95", "BP 160/95 end", { category: "measurements" }),
    ]);
    const result = resolveFacts(facts, input, "en");
    expect(result.resolutions).toHaveLength(0);
    expect(result.counts.total).toBe(0);
    expect(result.resolvedFacts.measurements).toHaveLength(2);
  });
});

describe("resolveFacts — edge cases", () => {
  it("handles empty facts and empty input gracefully", () => {
    const result = resolveFacts(emptyExtractedFacts(), { chunks: [] }, "en");
    expect(result.resolutions).toEqual([]);
    expect(result.counts.total).toBe(0);
  });

  it("keeps facts whose evidence cannot be located anywhere", () => {
    // Validator would normally drop these, but resolver must be safe
    // if a fact with unresolvable evidence slips through.
    const input: FactExtractionInput = { chunks: ["nothing related here"] };
    const facts = bundle([fact("orphan fact", "completely absent phrase")]);
    const result = resolveFacts(facts, input, "en");
    expect(result.resolvedFacts.diagnoses).toHaveLength(1);
  });

  it("ignores correction phrases that are split across sources", () => {
    // Evidence is in chunk 0; "actually" is in chunk 1. These are not
    // contiguous in any single source so the phrase should not count.
    const input: FactExtractionInput = {
      chunks: ["Patient has MI", "Actually stroke was the finding."],
    };
    const facts = bundle([fact("MI", "Patient has MI", { sourceIndex: 0 })]);
    const result = resolveFacts(facts, input, "en");
    expect(result.counts.correctionDrops).toBe(0);
    expect(result.resolvedFacts.diagnoses).toHaveLength(1);
  });
});
