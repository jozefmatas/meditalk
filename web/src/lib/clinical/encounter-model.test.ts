import { describe, it, expect } from "vitest";
import {
  buildEncounterModel,
  classifyProblem,
  factId,
} from "./encounter-model";
import { renderAssessmentFromModel } from "./renderers/assessment";
import {
  emptyExtractedFacts,
  type ExtractedFact,
  type ExtractedFacts,
} from "./fact-extraction";
import type { CandidateIcdCode } from "./types";

function fact(
  category: ExtractedFact["category"],
  value: string,
  negated = false,
): ExtractedFact {
  return {
    category,
    value,
    source: { type: "transcript", sourceIndex: 0, evidence: value },
    ...(negated ? { negated: true as const } : {}),
  };
}

function facts(...list: ExtractedFact[]): ExtractedFacts {
  const f = emptyExtractedFacts();
  for (const it of list) (f[it.category] as ExtractedFact[]).push(it);
  return f;
}

function icd(
  code: string,
  description: string,
  factIds: string[] = [],
): CandidateIcdCode & { factIds?: string[]; canonicalDescription?: string } {
  return {
    code,
    description,
    confidence: "high",
    sourceConceptIds: [],
    factIds: factIds.length > 0 ? factIds : undefined,
    canonicalDescription: description,
  };
}

describe("factId", () => {
  it("produces the stable category-index form used throughout the pipeline", () => {
    expect(factId("diagnoses", 0)).toBe("diagnoses-0");
    expect(factId("personalHistory", 3)).toBe("personalHistory-3");
  });
});

describe("classifyProblem", () => {
  it("sends 'versus' items to differential", () => {
    expect(classifyProblem({ label: "MGUS versus lymphoma" })).toEqual({
      certainty: "differential",
      priority: "active-supporting",
    });
  });

  it("sends 'stav po' items to chronic", () => {
    expect(
      classifyProblem({ label: "Stav po operácii katarakty bilaterálne" }),
    ).toEqual({ certainty: "final", priority: "chronic" });
  });

  it("personalHistory origin → chronic", () => {
    expect(
      classifyProblem({
        label: "Fibrilácia predsiení",
        factOriginCategory: "personalHistory",
      }),
    ).toEqual({ certainty: "final", priority: "chronic" });
  });

  it("chronic-marker labels → chronic", () => {
    expect(
      classifyProblem({
        label: "Primárna esenciálna artériová hypertenzia",
        icdCode: "I10",
      }),
    ).toEqual({ certainty: "final", priority: "chronic" });
  });

  it("acute ICD prefix → primary (encounter-driving)", () => {
    expect(
      classifyProblem({
        label: "Akútny subendokardiálny infarkt myokardu",
        icdCode: "I21.4",
      }),
    ).toEqual({ certainty: "final", priority: "encounter-driving" });
  });

  it("default: active supporting", () => {
    expect(
      classifyProblem({
        label: "Iná bolesť v hrudníku",
        icdCode: "R07.3",
      }),
    ).toEqual({ certainty: "working", priority: "active-supporting" });
  });
});

describe("buildEncounterModel — history routing", () => {
  it("puts family / personal / social / work / habits / medications in history", () => {
    const model = buildEncounterModel({
      language: "sk",
      facts: facts(
        fact("familyHistory", "Otec zomrel v 68 rokoch na infarkt"),
        fact("personalHistory", "Hypertenzia"),
        fact("socialHistory", "Žije s manželom"),
        fact("workHistory", "Pracuje v bezpečnostnej službe"),
        fact("substanceUse", "Fajčiar, fajčí 15 cigariet/deň"),
        fact("medications", "Rytmonorm 1-0-1"),
      ),
      candidateIcdCodes: [],
    });
    expect(model.history.family).toHaveLength(1);
    expect(model.history.personal).toHaveLength(1);
    expect(model.history.social).toHaveLength(1);
    expect(model.history.work).toHaveLength(1);
    expect(model.history.habits).toHaveLength(1);
    expect(model.history.medications).toHaveLength(1);
  });

  it("drops negated medications from history.medications", () => {
    const model = buildEncounterModel({
      language: "sk",
      facts: facts(
        fact("medications", "Warfarin", true),
        fact("medications", "Rytmonorm 1-0-1"),
      ),
      candidateIcdCodes: [],
    });
    expect(model.history.medications).toHaveLength(1);
    expect(model.history.medications[0].value).toBe("Rytmonorm 1-0-1");
  });
});

describe("buildEncounterModel — objective partitioning", () => {
  it("partitions measurements into vitals vs labs", () => {
    const model = buildEncounterModel({
      language: "sk",
      facts: facts(
        fact("measurements", "TK 150/80 mmHg (14:02)"),
        fact("measurements", "SF 68/min"),
        fact("measurements", "Glykémia 11,1 mmol/l"),
      ),
      candidateIcdCodes: [],
    });
    expect(model.objective.vitals.length).toBe(2);
    expect(model.objective.labs.length).toBe(1);
    expect(model.objective.labs[0].value).toContain("Glykémia");
  });

  it("partitions findings into ecg / imaging / exam", () => {
    const model = buildEncounterModel({
      language: "sk",
      facts: facts(
        fact(
          "findings",
          "EKG 12-zvodové: SR SF 68/min, ST elevácia v aVL a I",
        ),
        fact(
          "findings",
          "RTG hrudníka: pľúcny parenchým bez čerstvých ložiskových zmien",
        ),
        fact("findings", "Pacient pri vedomí, GCS 15, orientovaný"),
      ),
      candidateIcdCodes: [],
    });
    expect(model.objective.studies.ecg.length).toBe(1);
    expect(model.objective.studies.imaging.length).toBe(1);
    expect(model.objective.examFindings.length).toBe(1);
  });
});

describe("buildEncounterModel — problem classification", () => {
  it("NSTEMI → primary, R07.3/R42 suppressed when primary is I21.x", () => {
    const model = buildEncounterModel({
      language: "sk",
      facts: facts(
        fact("diagnoses", "NSTEMI"),
        fact("findings", "Bolest v hrudniku"),
      ),
      candidateIcdCodes: [
        icd("I21.4", "Akútny subendokardiálny infarkt myokardu", [
          "diagnoses-0",
        ]),
        icd("R07.3", "Iná bolesť v hrudníku"),
        icd("R42", "Závrat vertigo"),
        icd("I48", "Fibrilácia predsiení"),
      ],
    });
    expect(model.currentEncounter.primaryProblem?.icdCode).toBe("I21.4");
    // R07.3 / R42 are redundant with an I21.x primary → dropped
    expect(
      model.currentEncounter.supportingProblems.some(
        (p) => p.icdCode === "R07.3",
      ),
    ).toBe(false);
    expect(
      model.currentEncounter.supportingProblems.some(
        (p) => p.icdCode === "R42",
      ),
    ).toBe(false);
    // I48 stays as supporting (distinct active diagnosis)
    expect(
      model.currentEncounter.supportingProblems.some((p) => p.icdCode === "I48"),
    ).toBe(true);
  });

  it("'Diferenciálne diagnosticky NSTEMI' routes to differential, not primary", () => {
    const model = buildEncounterModel({
      language: "sk",
      facts: facts(),
      candidateIcdCodes: [
        {
          code: "I21.4",
          description: "Diferenciálne diagnosticky NSTEMI",
          confidence: "medium",
          sourceConceptIds: [],
        },
      ],
    });
    // When the label carries a differential marker, classifier sends it
    // to differential — primary stays empty.
    expect(model.currentEncounter.primaryProblem).toBeNull();
    expect(model.currentEncounter.differentialProblems.length).toBe(1);
  });

  it("collapses loose-overlap differential when primary already covers it", () => {
    const model = buildEncounterModel({
      language: "sk",
      facts: facts(),
      candidateIcdCodes: [
        icd("I21.4", "Akútny subendokardiálny infarkt myokardu"),
        // Differential entry that textually overlaps the primary label
        {
          code: "I99",
          description: "Akútny subendokardiálny infarkt myokardu (diff dg)",
          confidence: "low",
          sourceConceptIds: [],
        },
      ],
    });
    expect(model.currentEncounter.primaryProblem?.icdCode).toBe("I21.4");
    // Differential overlapping the primary label is dropped.
    expect(
      model.currentEncounter.differentialProblems.some(
        (p) => p.icdCode === "I99",
      ),
    ).toBe(false);
  });

  it("chronic conditions land in chronicConditions", () => {
    const model = buildEncounterModel({
      language: "sk",
      facts: facts(),
      candidateIcdCodes: [
        icd("I10", "Primárna [esenciálna] artériová hypertenzia"),
        icd("E03.9", "Hypotyreóza, bližšie neurčená (po strumektómii)"),
      ],
    });
    expect(model.chronicConditions.map((p) => p.icdCode).sort()).toEqual([
      "E03.9",
      "I10",
    ]);
  });
});

describe("renderAssessmentFromModel", () => {
  it("renders Slovak headings in fixed order, omitting empty buckets", () => {
    const model = buildEncounterModel({
      language: "sk",
      facts: facts(),
      candidateIcdCodes: [
        icd("I21.4", "Akútny subendokardiálny infarkt myokardu"),
        icd("I48", "Fibrilácia predsiení"),
        icd("I10", "Primárna esenciálna artériová hypertenzia"),
      ],
    });
    const text = renderAssessmentFromModel(model);
    const pI = text.indexOf("Hlavná diagnóza");
    const sI = text.indexOf("Vedľajšie diagnózy");
    const cI = text.indexOf("Chronické ochorenia");
    expect(pI).toBeGreaterThanOrEqual(0);
    expect(pI).toBeLessThan(sI);
    expect(sI).toBeLessThan(cI);
    expect(text).toContain("I21.4 Akútny subendokardiálny infarkt myokardu");
    expect(text).not.toContain("Diferenciálna diagnostika");
  });

  it("returns '' for an empty model", () => {
    const model = buildEncounterModel({
      language: "sk",
      facts: facts(),
      candidateIcdCodes: [],
    });
    expect(renderAssessmentFromModel(model)).toBe("");
  });
});
