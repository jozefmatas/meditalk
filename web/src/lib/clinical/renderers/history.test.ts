/**
 * Regression tests for the strict no-summarization contract applied
 * to history-section deterministic renderers.
 *
 * These renderers are pure TypeScript — they receive `model.history.*`
 * and must emit every non-negated fact verbatim. If these ever start
 * dropping items or inverting meaning, we have regressed on the
 * "LLM as formatter only" principle (these aren't even LLM-backed).
 */

import { describe, it, expect } from "vitest";
import {
  renderPersonalHistorySection,
  renderHabitsSection,
  renderAllergiesSection,
  renderMedicationsSection,
  renderFamilyHistorySection,
  renderSocialHistorySection,
  renderWorkHistorySection,
} from "./history";
import { buildEncounterModel } from "../encounter-model";
import { emptyExtractedFacts, type ExtractedFact } from "../fact-extraction";

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

describe("OA — must preserve every chronic comorbidity", () => {
  it("renders all 10 conditions from a dense compound history", () => {
    const facts = emptyExtractedFacts();
    // The kind of compound sentence the doctor writes — one fact
    // per condition is the contract.
    const conditions = [
      "Hypertenzia",
      "Hyperurikémia",
      "Paroxyzmálna fibrilácia predsiení",
      "Mitrálna regurgitácia",
      "Syndróm spánkového apnoe",
      "Stav po parciálnej strumektómii",
      "Stav po operácii slepého čreva",
      "Stav po kyretáži maternice pre myóm",
      "Monoklonálna gamapatia typu IgG kappa",
      "Artralgie pri artróze",
    ];
    for (const c of conditions) facts.personalHistory.push(fact("personalHistory", c));

    const model = buildEncounterModel({
      language: "sk",
      facts,
      candidateIcdCodes: [],
    });
    const rendered = renderPersonalHistorySection(model);

    // Every condition name's primary discriminating token must appear.
    for (const c of conditions) {
      const discriminator = c
        .toLowerCase()
        .split(/\s+/)[0]
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "");
      expect(rendered.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")).toContain(
        discriminator,
      );
    }
  });
});

describe("Ab — must NOT invert meaning of habits", () => {
  it("keeps 'alkohol príležitostne' as-is (occasional, not denied)", () => {
    const facts = emptyExtractedFacts();
    facts.substanceUse.push(fact("substanceUse", "alkohol príležitostne"));
    facts.substanceUse.push(fact("substanceUse", "nefajčí"));
    const model = buildEncounterModel({
      language: "sk",
      facts,
      candidateIcdCodes: [],
    });
    const rendered = renderHabitsSection(model);
    expect(rendered).toContain("alkohol príležitostne");
    // Critically: must NOT contain a "neguje alkohol" / "denies alcohol"
    // inversion of the meaning.
    expect(rendered).not.toMatch(/neguje\s+alkohol/i);
    expect(rendered).not.toMatch(/bez\s+alkohol/i);
  });

  it("preserves both substances when each has its own fact", () => {
    const facts = emptyExtractedFacts();
    facts.substanceUse.push(fact("substanceUse", "fajčiar, fajčí 15 cigariet denne"));
    facts.substanceUse.push(fact("substanceUse", "alkohol príležitostne"));
    const model = buildEncounterModel({
      language: "sk",
      facts,
      candidateIcdCodes: [],
    });
    const rendered = renderHabitsSection(model);
    expect(rendered).toContain("fajčiar");
    expect(rendered).toContain("alkohol");
  });
});

describe("AA — preserves every allergen", () => {
  it("renders multiple allergies verbatim", () => {
    const facts = emptyExtractedFacts();
    // AA facts often extract into personalHistory; the model's
    // ALLERGY_KEYWORD_REGEX splits them out.
    facts.personalHistory.push(fact("personalHistory", "alergia na Candibene"));
    facts.personalHistory.push(fact("personalHistory", "alergia na mukolytiká"));
    const model = buildEncounterModel({
      language: "sk",
      facts,
      candidateIcdCodes: [],
    });
    const rendered = renderAllergiesSection(model);
    expect(rendered).toContain("Candibene");
    expect(rendered).toContain("mukolytiká");
  });
});

describe("LA — every unique medication must appear", () => {
  it("renders all 8 meds when doses make them distinct", () => {
    const facts = emptyExtractedFacts();
    const meds = [
      "Rytmonorm 325 mg 1-0-1",
      "Nolpaza 20 mg 1-0-0",
      "Pretsance 5 mg/5 mg 1-0-0",
      "Euthyrox 25 ug 1-0-0",
      "Paretin 20 mg 1-0-0",
      "Eliquis 5 mg 1-0-1",
      "Betaloc ZOK 25 mg 1-0-0",
      "Zaldiar 1-0-1",
    ];
    for (const m of meds) facts.medications.push(fact("medications", m));
    const model = buildEncounterModel({
      language: "sk",
      facts,
      candidateIcdCodes: [],
    });
    const rendered = renderMedicationsSection(model);
    // Each med's base name must appear.
    expect(rendered).toContain("Rytmonorm");
    expect(rendered).toContain("Nolpaza");
    expect(rendered).toContain("Pretsance");
    expect(rendered).toContain("Euthyrox");
    expect(rendered).toContain("Paretin");
    expect(rendered).toContain("Eliquis");
    expect(rendered).toContain("Betaloc");
    expect(rendered).toContain("Zaldiar");
  });

  it("collapses short+dose variants to the longer one", () => {
    const facts = emptyExtractedFacts();
    facts.medications.push(fact("medications", "Rytmonorm 1-0-1"));
    facts.medications.push(fact("medications", "Rytmonorm 325 mg 1-0-1"));
    const model = buildEncounterModel({
      language: "sk",
      facts,
      candidateIcdCodes: [],
    });
    const rendered = renderMedicationsSection(model);
    // Longer variant kept (contains "325 mg").
    expect(rendered).toContain("Rytmonorm 325 mg 1-0-1");
    // The shorter variant should NOT also appear as a separate line.
    expect(
      rendered.split("\n").filter((l) => l.trim() === "Rytmonorm 1-0-1"),
    ).toHaveLength(0);
  });
});

describe("RA / SA / PA — each scopes to its own slot", () => {
  it("RA renders family facts, not social/work", () => {
    const facts = emptyExtractedFacts();
    facts.familyHistory.push(
      fact("familyHistory", "otec zomrel na zlyhanie obličiek"),
    );
    facts.socialHistory.push(fact("socialHistory", "žije s manželom"));
    facts.workHistory.push(fact("workHistory", "účtovníctvo"));
    const model = buildEncounterModel({
      language: "sk",
      facts,
      candidateIcdCodes: [],
    });
    expect(renderFamilyHistorySection(model)).toContain("otec");
    expect(renderFamilyHistorySection(model)).not.toContain("manželom");
    expect(renderFamilyHistorySection(model)).not.toContain("účtovníctvo");
    expect(renderSocialHistorySection(model)).toContain("manželom");
    expect(renderWorkHistorySection(model)).toContain("účtovníctvo");
  });
});
