import { describe, it, expect } from "vitest";
import {
  assignFactsToSections,
  formatAssignedFactsForPrompt,
} from "./fact-section-assigner";
import { emptyExtractedFacts } from "./fact-extraction";
import type { ExtractedFact, ExtractedFacts } from "./fact-extraction";

/** Helper: create a fact with the given category and value. */
function fact(
  category: ExtractedFact["category"],
  value: string,
): ExtractedFact {
  return {
    category,
    value,
    source: { type: "transcript", sourceIndex: 0, evidence: value },
  };
}

/** Helper: build facts with specific categories populated. */
function makeFacts(overrides: Partial<ExtractedFacts> = {}): ExtractedFacts {
  return { ...emptyExtractedFacts(), ...overrides };
}

describe("assignFactsToSections — focused template with abbreviations", () => {
  const sectionLabels: Record<string, string> = {
    s_ra: "RA",
    s_oa: "OA",
    s_sa: "SA",
    s_pa: "PA",
    s_la: "LA",
    s_ab: "Ab",
    s_ea: "EA",
    s_to: "TO",
    s_zaver: "Záver",
  };
  const sectionContexts: Record<string, string> = {
    s_ra: "Rodinná anamnéza (Family history). Ochorenia rodičov.",
    s_oa: "Osobná anamnéza (Past medical history). Vlastné ochorenia.",
    s_sa: "Sociálna anamnéza (Social history). Rodinný stav, bývanie.",
    s_pa: "Pracovná anamnéza (Occupational history). Zamestnanie.",
    s_la: "Lieková anamnéza (Current medications). Všetky lieky.",
    s_ab: "Abúzy (Substance use). Fajčenie, alkohol, drogy.",
    s_ea: "Epidemiologická anamnéza. Cestovanie, kontakt s infekciami.",
    s_to: "Terajšie ochorenie (History of present illness). Symptómy.",
    s_zaver: "Záver / Assessment. Diagnózy.",
  };

  it("assigns familyHistory to RA section via context", () => {
    const facts = makeFacts({
      familyHistory: [fact("familyHistory", "otec mal infarkt v 55r")],
    });
    const result = assignFactsToSections(facts, sectionLabels, sectionContexts);
    expect(result["s_ra"]).toHaveLength(1);
    expect(result["s_ra"]![0].value).toBe("otec mal infarkt v 55r");
  });

  it("assigns personalHistory to OA section via context", () => {
    const facts = makeFacts({
      personalHistory: [
        fact("personalHistory", "chronická hypertenzia od 2010"),
      ],
    });
    const result = assignFactsToSections(facts, sectionLabels, sectionContexts);
    expect(result["s_oa"]).toHaveLength(1);
  });

  it("assigns medications to LA section via context", () => {
    const facts = makeFacts({
      medications: [fact("medications", "Bisoprolol 5mg 1-0-0")],
    });
    const result = assignFactsToSections(facts, sectionLabels, sectionContexts);
    expect(result["s_la"]).toHaveLength(1);
  });

  it("assigns substanceUse to Ab section via context", () => {
    const facts = makeFacts({
      substanceUse: [fact("substanceUse", "fajčí 15 cigariet denne")],
    });
    const result = assignFactsToSections(facts, sectionLabels, sectionContexts);
    expect(result["s_ab"]).toHaveLength(1);
  });

  it("assigns socialHistory to SA section via context", () => {
    const facts = makeFacts({
      socialHistory: [fact("socialHistory", "ženatý, žije s manželkou")],
    });
    const result = assignFactsToSections(facts, sectionLabels, sectionContexts);
    expect(result["s_sa"]).toHaveLength(1);
  });

  it("assigns workHistory to PA section via context", () => {
    const facts = makeFacts({
      workHistory: [fact("workHistory", "pracuje ako elektrikár")],
    });
    const result = assignFactsToSections(facts, sectionLabels, sectionContexts);
    expect(result["s_pa"]).toHaveLength(1);
  });

  it("assigns epidemiologicalHistory to EA section via context", () => {
    const facts = makeFacts({
      epidemiologicalHistory: [
        fact("epidemiologicalHistory", "necestoval do zahraničia"),
      ],
    });
    const result = assignFactsToSections(facts, sectionLabels, sectionContexts);
    expect(result["s_ea"]).toHaveLength(1);
  });

  it("assigns diagnoses to Záver section via context", () => {
    const facts = makeFacts({
      diagnoses: [fact("diagnoses", "akútny infarkt myokardu")],
    });
    const result = assignFactsToSections(facts, sectionLabels, sectionContexts);
    expect(result["s_zaver"]).toHaveLength(1);
  });

  it("assigns multiple categories to their respective sections", () => {
    const facts = makeFacts({
      familyHistory: [fact("familyHistory", "otec DM")],
      medications: [fact("medications", "Metformin 500mg")],
      substanceUse: [fact("substanceUse", "nefajčí")],
      diagnoses: [fact("diagnoses", "DM 2. typu")],
    });
    const result = assignFactsToSections(facts, sectionLabels, sectionContexts);
    expect(result["s_ra"]).toHaveLength(1);
    expect(result["s_la"]).toHaveLength(1);
    expect(result["s_ab"]).toHaveLength(1);
    expect(result["s_zaver"]).toHaveLength(1);
  });
});

describe("assignFactsToSections — label-only matching (no contexts)", () => {
  const sectionLabels: Record<string, string> = {
    s_ra: "RA",
    s_oa: "OA",
    s_la: "LA",
    s_ab: "Ab",
    s_pa: "PA",
    s_sa: "SA",
  };

  it("matches familyHistory to RA by exact abbreviation", () => {
    const facts = makeFacts({
      familyHistory: [fact("familyHistory", "matka hypertenzia")],
    });
    const result = assignFactsToSections(facts, sectionLabels);
    expect(result["s_ra"]).toHaveLength(1);
  });

  it("matches substanceUse to Ab by exact abbreviation", () => {
    const facts = makeFacts({
      substanceUse: [fact("substanceUse", "alkohol príležitostne")],
    });
    const result = assignFactsToSections(facts, sectionLabels);
    expect(result["s_ab"]).toHaveLength(1);
  });
});

describe("assignFactsToSections — unassigned facts", () => {
  it("puts unmatched categories under _unassigned", () => {
    const sectionLabels: Record<string, string> = {
      s_zaver: "Záver",
    };
    const facts = makeFacts({
      symptoms: [fact("symptoms", "bolesť na hrudníku")],
    });
    const result = assignFactsToSections(facts, sectionLabels);
    expect(result["_unassigned"]).toHaveLength(1);
  });

  it("skips empty categories (no unnecessary _unassigned entries)", () => {
    const facts = emptyExtractedFacts();
    const result = assignFactsToSections(facts, { s1: "RA" });
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe("assignFactsToSections — determinism", () => {
  it("produces identical output across invocations", () => {
    const labels = { s_ra: "RA", s_la: "LA", s_ab: "Ab" };
    const contexts = {
      s_ra: "Rodinná anamnéza (Family history).",
      s_la: "Lieková anamnéza (Current medications).",
      s_ab: "Abúzy (Substance use). Fajčenie, alkohol.",
    };
    const facts = makeFacts({
      familyHistory: [fact("familyHistory", "otec DM")],
      medications: [fact("medications", "Bisoprolol 5mg")],
      substanceUse: [fact("substanceUse", "fajčí 10 denne")],
    });
    const r1 = assignFactsToSections(facts, labels, contexts);
    const r2 = assignFactsToSections(facts, labels, contexts);
    const r3 = assignFactsToSections(facts, labels, contexts);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });
});

describe("formatAssignedFactsForPrompt", () => {
  it("groups facts by section with labels", () => {
    const assignment: Record<string, ExtractedFact[]> = {
      s_ra: [fact("familyHistory", "otec DM")],
      s_la: [
        fact("medications", "Bisoprolol 5mg"),
        fact("medications", "Ramipril 10mg"),
      ],
    };
    const labels = { s_ra: "RA", s_la: "LA", s_zaver: "Záver" };
    const output = formatAssignedFactsForPrompt(assignment, labels);
    expect(output).toContain('[Section "RA" (s_ra)]');
    expect(output).toContain("  - [Family History] otec DM");
    expect(output).toContain('[Section "LA" (s_la)]');
    expect(output).toContain("  - [Medications] Bisoprolol 5mg");
    expect(output).toContain("  - [Medications] Ramipril 10mg");
  });

  it("renders unassigned facts under general context", () => {
    const assignment: Record<string, ExtractedFact[]> = {
      _unassigned: [fact("symptoms", "bolesť na hrudníku")],
    };
    const labels = { s1: "Záver" };
    const output = formatAssignedFactsForPrompt(assignment, labels);
    expect(output).toContain("General context");
    expect(output).toContain("  - [Symptoms] bolesť na hrudníku");
  });

  it("omits sections that have no facts", () => {
    const assignment: Record<string, ExtractedFact[]> = {
      s_ra: [fact("familyHistory", "otec DM")],
    };
    const labels = { s_ra: "RA", s_la: "LA", s_zaver: "Záver" };
    const output = formatAssignedFactsForPrompt(assignment, labels);
    expect(output).toContain("RA");
    expect(output).not.toContain("LA");
    expect(output).not.toContain("Záver");
  });

  it("respects section label ordering", () => {
    const assignment: Record<string, ExtractedFact[]> = {
      s_la: [fact("medications", "Bisoprolol 5mg")],
      s_ra: [fact("familyHistory", "otec DM")],
    };
    const labels = { s_ra: "RA", s_la: "LA" };
    const output = formatAssignedFactsForPrompt(assignment, labels);
    const raPos = output.indexOf("RA");
    const laPos = output.indexOf("LA");
    // RA comes before LA in sectionLabels
    expect(raPos).toBeLessThan(laPos);
  });
});

describe("assignFactsToSections — TO/HPI routing", () => {
  it("assigns chiefComplaint to TO section via exact label match", () => {
    const labels = { s_to: "TO", s_la: "LA" };
    const facts = makeFacts({
      chiefComplaint: [fact("chiefComplaint", "bolesť na hrudníku od rána")],
    });
    const result = assignFactsToSections(facts, labels);
    expect(result["s_to"]).toHaveLength(1);
    expect(result["s_to"]![0].value).toBe("bolesť na hrudníku od rána");
  });

  it("assigns chiefComplaint to 'Terajšie ochorenie' section via context", () => {
    const labels = { s_to: "Terajšie ochorenie", s_la: "LA" };
    const contexts = {
      s_to: "Terajšie ochorenie (History of present illness).",
      s_la: "Lieková anamnéza.",
    };
    const facts = makeFacts({
      chiefComplaint: [fact("chiefComplaint", "tlaková bolesť od 13:00")],
    });
    const result = assignFactsToSections(facts, labels, contexts);
    expect(result["s_to"]).toHaveLength(1);
  });

  it("assigns chiefComplaint to HPI section via label match", () => {
    const labels = { s_hpi: "HPI", s_la: "LA" };
    const facts = makeFacts({
      chiefComplaint: [fact("chiefComplaint", "chest pain since morning")],
    });
    const result = assignFactsToSections(facts, labels);
    expect(result["s_hpi"]).toHaveLength(1);
  });

  it("assigns chiefComplaint to 'History of Present Illness' section", () => {
    const labels = { s_hpi: "History of Present Illness", s_la: "LA" };
    const facts = makeFacts({
      chiefComplaint: [fact("chiefComplaint", "chest pain since morning")],
    });
    const result = assignFactsToSections(facts, labels);
    expect(result["s_hpi"]).toHaveLength(1);
  });

  it("assigns chiefComplaint to 'Dôvod kontaktu' section", () => {
    const labels = { s_dk: "Dôvod kontaktu", s_la: "LA" };
    const facts = makeFacts({
      chiefComplaint: [fact("chiefComplaint", "pálenie záhy")],
    });
    const result = assignFactsToSections(facts, labels);
    expect(result["s_dk"]).toHaveLength(1);
  });

  it("chiefComplaint takes priority over symptoms for TO section", () => {
    const labels = { s_to: "TO" };
    const facts = makeFacts({
      chiefComplaint: [fact("chiefComplaint", "bolesť na hrudníku od rána")],
      symptoms: [fact("symptoms", "dýchavičnosť")],
    });
    const result = assignFactsToSections(facts, labels);
    // chiefComplaint should be assigned to TO (first match wins due to FACT_CATEGORIES order)
    expect(result["s_to"]).toBeDefined();
    const categories = result["s_to"]!.map((f) => f.category);
    expect(categories).toContain("chiefComplaint");
    // symptoms also route to TO
    expect(categories).toContain("symptoms");
  });

  it("assigns symptoms to TO section when no chiefComplaint facts exist", () => {
    const labels = { s_to: "TO" };
    const facts = makeFacts({
      symptoms: [fact("symptoms", "dýchavičnosť pri námahe")],
    });
    const result = assignFactsToSections(facts, labels);
    expect(result["s_to"]).toHaveLength(1);
    expect(result["s_to"]![0].category).toBe("symptoms");
  });
});
