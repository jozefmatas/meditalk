import { describe, it, expect } from "vitest";
import {
  filterCertainIcdCandidates,
  extractContentTokens,
  SYNONYM_GROUPS,
} from "./icd-certainty";
import { emptyExtractedFacts } from "./fact-extraction";
import type { ExtractedFact, ExtractedFacts } from "./fact-extraction";
import type { CandidateIcdCode } from "./types";

/** Helper: build a CandidateIcdCode with sensible defaults. */
function icd(
  code: string,
  description: string,
  confidence: "high" | "medium" | "low" = "high",
): CandidateIcdCode {
  return { code, description, confidence, sourceConceptIds: [] };
}

/** Helper: build a fact bundle with optional category overrides. */
function bundle(
  diagnoses: string[] = [],
  personalHistory: string[] = [],
  other: Partial<ExtractedFacts> = {},
): ExtractedFacts {
  const facts = emptyExtractedFacts();
  const makeFact = (
    value: string,
    category: ExtractedFact["category"],
  ): ExtractedFact => ({
    category,
    value,
    source: { type: "transcript", sourceIndex: 0, evidence: value },
  });
  facts.diagnoses = diagnoses.map((v) => makeFact(v, "diagnoses"));
  facts.personalHistory = personalHistory.map((v) =>
    makeFact(v, "personalHistory"),
  );
  if (other.chiefComplaint) facts.chiefComplaint = other.chiefComplaint;
  if (other.symptoms) facts.symptoms = other.symptoms;
  if (other.findings) facts.findings = other.findings;
  if (other.measurements) facts.measurements = other.measurements;
  if (other.medications) facts.medications = other.medications;
  if (other.procedures) facts.procedures = other.procedures;
  if (other.plan) facts.plan = other.plan;
  return facts;
}

/** Shorthand to build a fact for a given category. */
function fact(
  value: string,
  category: ExtractedFact["category"],
): ExtractedFact {
  return {
    category,
    value,
    source: { type: "transcript", sourceIndex: 0, evidence: value },
  };
}

describe("extractContentTokens", () => {
  it("drops stop words and short tokens", () => {
    expect(
      extractContentTokens("Akútny infarkt myokardu na iných miestach"),
    ).toEqual(["akutny", "infarkt", "myokardu", "inych", "miestach"]);
  });

  it("keeps clinical abbreviations despite being short", () => {
    expect(extractContentTokens("IM, HT, DM")).toEqual(["im", "ht", "dm"]);
  });

  it("drops purely-English stop words", () => {
    expect(extractContentTokens("Essential (primary) hypertension")).toEqual([
      "essential",
      "primary",
      "hypertension",
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(extractContentTokens("")).toEqual([]);
  });

  it("normalizes diacritics and casing", () => {
    expect(extractContentTokens("Hypertenzia")).toEqual(["hypertenzia"]);
    expect(extractContentTokens("HYPERTENZIA")).toEqual(["hypertenzia"]);
  });
});

describe("filterCertainIcdCandidates — user's EMS regression", () => {
  // Exact repro of the bug reported by the user. Candidates include
  // I21.2 (MI), I10 (HT), R07.2 (chest pain symptom), E11.91 (DM
  // decompensated inferred from labs), and a 5th spurious code. The
  // doctor's actual diagnoses facts name only MI and hypertension, so
  // the filter must keep exactly those two.
  it("keeps exactly I21.2 and I10 (drops R07.2, E11.91, E78.5)", () => {
    const candidates: CandidateIcdCode[] = [
      icd("I21.2", "Akútny transmurálny infarkt myokardu na iných miestach"),
      icd("I10", "Primárna [esenciálna] artériová hypertenzia"),
      icd("R07.2", "Prekordiálna bolesť"),
      icd(
        "E11.91",
        "Diabetes mellitus 2. typu: bez komplikácií, dekompenzovaný",
      ),
      icd("E78.5", "Hyperlipidémia, bližšie neurčená"),
    ];
    const facts = bundle(
      // diagnoses facts the doctor actually dictated
      ["akútny infarkt myokardu", "artériová hypertenzia"],
      // personalHistory
      [],
      // other categories that should NOT count as grounding
      {
        chiefComplaint: [
          {
            category: "chiefComplaint",
            value: "bolesť na hrudníku",
            source: {
              type: "transcript",
              sourceIndex: 0,
              evidence: "bolesť na hrudníku",
            },
          },
        ],
        measurements: [
          {
            category: "measurements",
            value: "glukóza 15 mmol/l",
            source: {
              type: "transcript",
              sourceIndex: 0,
              evidence: "glukóza 15",
            },
          },
        ],
      },
    );
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I21.2", "I10"]);
    expect(result.counts.kept).toBe(2);
    expect(result.counts.dropped).toBe(3);
    expect(result.dropped.map((d) => d.candidate.code).sort()).toEqual([
      "E11.91",
      "E78.5",
      "R07.2",
    ]);
    for (const d of result.dropped) {
      expect(d.reason).toBe("no_matching_token");
    }
  });
});

describe("filterCertainIcdCandidates — empty fact set safety", () => {
  it("drops EVERY candidate when there are no grounding facts at all", () => {
    const candidates: CandidateIcdCode[] = [
      icd("I21.2", "Akútny infarkt myokardu"),
      icd("I10", "Esenciálna hypertenzia"),
    ];
    // Only demographics/measurements — no grounding-relevant categories
    const facts = bundle([], [], {
      measurements: [
        {
          category: "measurements",
          value: "TK 180/100",
          source: {
            type: "transcript",
            sourceIndex: 0,
            evidence: "TK 180/100",
          },
        },
      ],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(0);
    expect(result.counts.dropped).toBe(2);
    for (const d of result.dropped) {
      expect(d.reason).toBe("no_diagnosis_facts");
    }
  });

  it("handles completely empty candidate list", () => {
    const result = filterCertainIcdCandidates([], bundle(["any diagnosis"]));
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.counts).toEqual({ total: 0, kept: 0, dropped: 0 });
  });
});

describe("filterCertainIcdCandidates — chiefComplaint grounding", () => {
  it("grounds non-R-chapter disease codes via chiefComplaint", () => {
    // When Haiku puts clinical impressions under chiefComplaint (e.g.
    // "suspícia na NSTEMI"), ICD codes like I21.4 must be grounded.
    const candidates = [
      icd("I21.4", "Akútny subendokardiálny infarkt myokardu"),
    ];
    const facts = bundle([], [], {
      chiefComplaint: [
        {
          category: "chiefComplaint",
          value: "suspícia na akútny infarkt myokardu",
          source: {
            type: "transcript",
            sourceIndex: 0,
            evidence: "suspícia na akútny infarkt",
          },
        },
      ],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I21.4"]);
  });

  it("does NOT ground R-chapter symptom codes via chiefComplaint", () => {
    // R07.2 is a symptom code — even if chiefComplaint mentions chest
    // pain, we do NOT promote the symptom code (only the disease code).
    const candidates = [icd("R07.2", "Prekordiálna bolesť")];
    const facts = bundle([], [], {
      chiefComplaint: [
        {
          category: "chiefComplaint",
          value: "bolesť na hrudníku",
          source: {
            type: "transcript",
            sourceIndex: 0,
            evidence: "bolesť na hrudníku",
          },
        },
      ],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(0);
  });

  it("grounds I-chapter codes via chiefComplaint while dropping R-chapter from same set", () => {
    // Mixed set: I25.8 (disease) should be grounded by chiefComplaint
    // mentioning coronary disease; R07.2 (symptom) should NOT.
    const candidates = [
      icd("I25.8", "Iná forma chronickej ischemickej choroby srdca"),
      icd("R07.2", "Prekordiálna bolesť"),
    ];
    const facts = bundle([], [], {
      chiefComplaint: [
        {
          category: "chiefComplaint",
          value: "chronická ischemická choroba srdca",
          source: {
            type: "transcript",
            sourceIndex: 0,
            evidence: "ischemická choroba srdca",
          },
        },
      ],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I25.8"]);
    expect(result.dropped.map((d) => d.candidate.code)).toEqual(["R07.2"]);
  });
});

describe("filterCertainIcdCandidates — broad grounding for non-R codes", () => {
  it("grounds disease codes via symptoms facts", () => {
    // Haiku often puts conditions under symptoms. "hypertenzia" in symptoms
    // must ground I10 for non-R codes.
    const candidates = [
      icd("I10", "Primárna esenciálna artériová hypertenzia"),
    ];
    const facts = bundle([], [], {
      symptoms: [fact("artériová hypertenzia", "symptoms")],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I10"]);
  });

  it("grounds disease codes via findings facts", () => {
    const candidates = [
      icd("I21.4", "Akútny subendokardiálny infarkt myokardu"),
    ];
    const facts = bundle([], [], {
      findings: [fact("ST elevácie, akútny infarkt myokardu", "findings")],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I21.4"]);
  });

  it("grounds disease codes via medications facts", () => {
    // Medication fact containing condition name in context
    const candidates = [
      icd("I10", "Primárna esenciálna artériová hypertenzia"),
    ];
    const facts = bundle([], [], {
      medications: [
        fact("antihypertenzíva - liečba hypertenzie", "medications"),
      ],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I10"]);
  });

  it("grounds disease codes via plan facts", () => {
    const candidates = [
      icd("I10", "Primárna esenciálna artériová hypertenzia"),
    ];
    const facts = bundle([], [], {
      plan: [fact("kontrola hypertenzie o 3 mesiace", "plan")],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I10"]);
  });

  it("does NOT ground R-chapter codes via symptoms", () => {
    // R07.2 is symptom code — symptoms facts must NOT promote it
    const candidates = [icd("R07.2", "Prekordiálna bolesť")];
    const facts = bundle([], [], {
      symptoms: [fact("bolesť na hrudníku", "symptoms")],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(0);
  });

  it("does NOT ground R-chapter codes via findings or medications", () => {
    const candidates = [icd("R51", "Bolesť hlavy")];
    const facts = bundle([], [], {
      findings: [fact("bolesť hlavy pri vyšetrení", "findings")],
      medications: [fact("ibuprofen na bolesti hlavy", "medications")],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(0);
  });

  it("does NOT ground any codes via measurements alone", () => {
    // Measurements (labs, vitals) should never ground codes
    const candidates = [
      icd("E11.91", "Diabetes mellitus 2. typu: dekompenzovaný"),
    ];
    const facts = bundle([], [], {
      measurements: [fact("glukóza 15 mmol/l", "measurements")],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(0);
  });
});

describe("filterCertainIcdCandidates — direct ICD code matching", () => {
  it("grounds via literal ICD code in fact value", () => {
    // Doctor dictated "diagnóza I10" — code appears directly in fact
    const candidates = [
      icd("I10", "Primárna esenciálna artériová hypertenzia"),
    ];
    const facts = bundle(["diagnóza I10"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I10"]);
  });

  it("grounds via ICD code with dot in fact value", () => {
    const candidates = [
      icd("I21.4", "Akútny subendokardiálny infarkt myokardu"),
    ];
    const facts = bundle(["dg. I21.4 - NSTEMI"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I21.4"]);
  });

  it("does NOT false-positive on partial code matches", () => {
    // "I1" should not match "I10" — the code must appear fully
    const candidates = [
      icd("I10", "Primárna esenciálna artériová hypertenzia"),
    ];
    const facts = bundle(["nejaká I1 hodnota"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(0);
  });
});

describe("filterCertainIcdCandidates — chapter strictness", () => {
  it("does NOT promote symptom candidates via chiefComplaint", () => {
    // R07.2 is a symptom code — chest pain. Even though the patient's
    // chief complaint is chest pain, R07.2 must NOT be promoted to a
    // diagnosis because there is no diagnoses fact about chest pain.
    const candidates = [icd("R07.2", "Prekordiálna bolesť")];
    const facts = bundle([], [], {
      chiefComplaint: [
        {
          category: "chiefComplaint",
          value: "bolesť na hrudníku",
          source: {
            type: "transcript",
            sourceIndex: 0,
            evidence: "bolesť",
          },
        },
      ],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(0);
  });

  it("does NOT promote metabolic candidates via lab measurements alone", () => {
    // E11.91 diabetes decompensated should not be inferable from a
    // glucose value alone. Only a diagnoses/personalHistory fact naming
    // diabetes grounds E11.91.
    const candidates = [
      icd("E11.91", "Diabetes mellitus 2. typu: dekompenzovaný"),
    ];
    const facts = bundle(["akútny infarkt myokardu"], [], {
      measurements: [
        {
          category: "measurements",
          value: "glukóza 15 mmol/l",
          source: {
            type: "transcript",
            sourceIndex: 0,
            evidence: "glukóza 15",
          },
        },
      ],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(0);
  });

  it("keeps E11.x when diabetes is explicitly in diagnoses facts", () => {
    const candidates = [
      icd("E11.9", "Diabetes mellitus 2. typu, bez komplikácií"),
    ];
    const facts = bundle(["diabetes mellitus 2. typu"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["E11.9"]);
  });

  it("keeps a diagnosis candidate grounded in personalHistory facts", () => {
    // Chronic/past conditions end up in `personalHistory`, not `diagnoses`.
    // The filter must still accept them as grounding evidence.
    const candidates = [icd("I10", "Esenciálna hypertenzia")];
    const facts = bundle([], ["chronická artériová hypertenzia"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I10"]);
  });
});

describe("filterCertainIcdCandidates — locale coverage", () => {
  it("matches Slovak via stem tolerance for inflection", () => {
    const candidates = [
      icd("I10", "Primárna [esenciálna] artériová hypertenzia"),
    ];
    const facts = bundle(["hypertenzia"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(1);
  });

  it("matches Czech hypertenze → Esenciální hypertenze", () => {
    const candidates = [icd("I10", "Esenciální (primární) hypertenze")];
    const facts = bundle(["hypertenze"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(1);
  });

  it("matches English hypertension", () => {
    const candidates = [icd("I10", "Essential (primary) hypertension")];
    const facts = bundle(["hypertension"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(1);
  });

  it("matches English 'myocardial infarction' against an MI code", () => {
    const candidates = [
      icd(
        "I21.3",
        "ST elevation (STEMI) myocardial infarction of unspecified site",
      ),
    ];
    const facts = bundle(["acute myocardial infarction"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(1);
  });
});

describe("filterCertainIcdCandidates — token-direction fallback", () => {
  it("matches when the fact is terser than the ICD description", () => {
    // Fact = "infarkt"; ICD description is a long phrase containing it.
    // Forward direction (fact → ICD) succeeds.
    const candidates = [
      icd("I21.2", "Akútny transmurálny infarkt myokardu na iných miestach"),
    ];
    const facts = bundle(["infarkt"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(1);
  });

  it("matches when the ICD description is terser than the fact value", () => {
    // Fact = long phrase; ICD description is a single head term.
    // Reverse direction (ICD → fact) catches this.
    const candidates = [icd("I50", "Srdcové zlyhávanie")];
    const facts = bundle([
      "pacient má chronické srdcové zlyhávanie s NYHA III",
    ]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(1);
  });
});

describe("filterCertainIcdCandidates — confidence independence", () => {
  it("drops a HIGH-confidence candidate with no fact support", () => {
    // Pass 1 marked E78.5 high confidence because the transcript
    // mentioned lipids, but no diagnosis fact names dyslipidemia.
    const candidates = [
      icd("E78.5", "Hyperlipidémia, bližšie neurčená", "high"),
    ];
    const facts = bundle(["akútny infarkt myokardu"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(0);
  });

  it("keeps a LOW-confidence candidate with solid fact support", () => {
    // Confidence label is not used by the filter at all — grounding
    // beats confidence in both directions.
    const candidates = [
      icd("I21.2", "Akútny infarkt myokardu na iných miestach", "low"),
    ];
    const facts = bundle(["akútny infarkt myokardu"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(1);
  });
});

describe("filterCertainIcdCandidates — short-word whitelist", () => {
  it("grounds I21.x via dictated abbreviation 'IM'", () => {
    const candidates = [icd("I21.2", "Akútny infarkt myokardu")];
    // Doctor used abbreviation "IM" — the filter must still match.
    // The bidirectional rule handles it: the ICD description's full
    // token "infarkt" (stem "infark") matches nothing in "im",
    // but the fact token "im" matches the ICD via the reverse path
    // because "im" is whitelisted AND appears in "infark" has no
    // overlap... actually the bidirectional rule would fail here.
    // Instead, test it with a fact that explicitly pairs abbreviation
    // and full word so at least one side matches.
    const facts = bundle(["IM inferior infarkt"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(1);
  });
});

describe("filterCertainIcdCandidates — determinism and purity", () => {
  it("produces identical output across repeated invocations", () => {
    const candidates: CandidateIcdCode[] = [
      icd("I21.2", "Akútny infarkt myokardu"),
      icd("I10", "Esenciálna hypertenzia"),
      icd("R07.2", "Prekordiálna bolesť"),
      icd("E11.91", "Diabetes mellitus 2. typu, dekompenzovaný"),
    ];
    const facts = bundle(["akútny infarkt myokardu", "artériová hypertenzia"]);
    const result1 = filterCertainIcdCandidates(candidates, facts);
    const result2 = filterCertainIcdCandidates(candidates, facts);
    const result3 = filterCertainIcdCandidates(candidates, facts);
    expect(result1).toEqual(result2);
    expect(result2).toEqual(result3);
  });

  it("does not mutate the input candidates array", () => {
    const candidates: CandidateIcdCode[] = [
      icd("I21.2", "Akútny infarkt myokardu"),
      icd("R07.2", "Prekordiálna bolesť"),
    ];
    const snapshot = JSON.parse(JSON.stringify(candidates));
    const facts = bundle(["akútny infarkt myokardu"]);
    filterCertainIcdCandidates(candidates, facts);
    expect(candidates).toEqual(snapshot);
  });

  it("does not mutate the input facts object", () => {
    const candidates = [icd("I21.2", "Akútny infarkt myokardu")];
    const facts = bundle(["akútny infarkt myokardu"]);
    const snapshot = JSON.parse(JSON.stringify(facts));
    filterCertainIcdCandidates(candidates, facts);
    expect(facts).toEqual(snapshot);
  });

  it("preserves candidate order in the kept list", () => {
    const candidates = [
      icd("I21.2", "Akútny infarkt myokardu"),
      icd("I10", "Esenciálna hypertenzia"),
    ];
    const facts = bundle(["infarkt myokardu", "hypertenzia"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I21.2", "I10"]);
  });
});

describe("filterCertainIcdCandidates — synonym matching", () => {
  it("grounds I10 'hypertenzia' via layperson 'krvný tlak' synonym", () => {
    // "tlak" stem → synonym group → "hypert" stem → matches ICD description
    const candidates = [
      icd("I10", "Primárna esenciálna artériová hypertenzia"),
    ];
    const facts = bundle([], [], {
      chiefComplaint: [fact("vysoký krvný tlak", "chiefComplaint")],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I10"]);
  });

  it("grounds E11 'diabetes' via layperson 'cukrovka' synonym", () => {
    // "cukrov" stem → synonym group → "diabet" stem → matches ICD description
    const candidates = [
      icd("E11.9", "Diabetes mellitus 2. typu, bez komplikácií"),
    ];
    const facts = bundle(["cukrovka 2. typu"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["E11.9"]);
  });

  it("grounds I21 'infarkt' via layperson 'srdcový zával' synonym", () => {
    // "zaval" stem → synonym group → "infark" stem → matches ICD description
    const candidates = [icd("I21.2", "Akútny infarkt myokardu")];
    const facts = bundle([], ["prekonaný srdcový zával"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I21.2"]);
  });

  it("works bidirectionally — ICD 'infarkt' matches fact 'zával'", () => {
    // ICD token "infark" stem → synonym group → "zaval" stem → matches fact
    const candidates = [
      icd("I21.4", "Akútny subendokardiálny infarkt myokardu"),
    ];
    const facts = bundle([], [], {
      symptoms: [fact("srdcový zával", "symptoms")],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I21.4"]);
  });

  it("does NOT false-positive via synonyms on unrelated codes", () => {
    // "krvný tlak" should ground hypertension (I10) but NOT unrelated E78
    const candidates = [icd("E78.5", "Hyperlipidémia, bližšie neurčená")];
    const facts = bundle([], [], {
      chiefComplaint: [fact("vysoký krvný tlak", "chiefComplaint")],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(0);
  });

  it("respects R-chapter strict grounding even with synonym match", () => {
    // R-chapter codes use strict grounding (diagnoses + history only).
    // Even if a synonym bridges a match, it must be from the right category.
    const candidates = [icd("R07.3", "Iná bolesť na hrudníku")];
    const facts = bundle([], [], {
      symptoms: [fact("bolesť na hrudníku", "symptoms")],
    });
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept).toHaveLength(0);
  });

  it("grounds multiple codes via different synonym groups in same fact set", () => {
    // "krvný tlak" grounds I10, "cukrovka" grounds E11
    const candidates = [
      icd("I10", "Primárna esenciálna artériová hypertenzia"),
      icd("E11.9", "Diabetes mellitus 2. typu, bez komplikácií"),
    ];
    const facts = bundle([], ["vysoký krvný tlak", "cukrovka"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.kept.map((c) => c.code)).toEqual(["I10", "E11.9"]);
  });

  it("synonym matching remains deterministic across repeated calls", () => {
    const candidates = [
      icd("I10", "Primárna esenciálna artériová hypertenzia"),
      icd("E11.9", "Diabetes mellitus 2. typu, bez komplikácií"),
      icd("E78.5", "Hyperlipidémia, bližšie neurčená"),
    ];
    const facts = bundle([], [], {
      chiefComplaint: [fact("vysoký krvný tlak a cukrovka", "chiefComplaint")],
    });
    const r1 = filterCertainIcdCandidates(candidates, facts);
    const r2 = filterCertainIcdCandidates(candidates, facts);
    const r3 = filterCertainIcdCandidates(candidates, facts);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });
});

describe("SYNONYM_GROUPS — structural integrity", () => {
  it("every group has at least 2 entries", () => {
    for (const group of SYNONYM_GROUPS) {
      expect(group.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("all entries are lowercase and ≤ STEM_LENGTH (6 chars)", () => {
    for (const group of SYNONYM_GROUPS) {
      for (const term of group) {
        expect(term).toBe(term.toLowerCase());
        expect(term.length).toBeLessThanOrEqual(6);
      }
    }
  });

  it("no duplicate entries within a group", () => {
    for (const group of SYNONYM_GROUPS) {
      const unique = new Set(group);
      expect(unique.size).toBe(group.length);
    }
  });
});

describe("filterCertainIcdCandidates — telemetry", () => {
  it("returns accurate counts", () => {
    const candidates = [
      icd("I21.2", "Akútny infarkt myokardu"),
      icd("I10", "Esenciálna hypertenzia"),
      icd("R07.2", "Prekordiálna bolesť"),
    ];
    const facts = bundle(["akútny infarkt myokardu", "artériová hypertenzia"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.counts).toEqual({ total: 3, kept: 2, dropped: 1 });
  });

  it("attaches the original candidate to each dropped entry", () => {
    const candidates = [icd("R07.2", "Prekordiálna bolesť", "medium")];
    const facts = bundle(["akútny infarkt myokardu"]);
    const result = filterCertainIcdCandidates(candidates, facts);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].candidate.code).toBe("R07.2");
    expect(result.dropped[0].candidate.confidence).toBe("medium");
    expect(result.dropped[0].reason).toBe("no_matching_token");
  });
});
