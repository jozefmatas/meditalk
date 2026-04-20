import { describe, it, expect } from "vitest";
import {
  resolveSpecialtyPack,
  registerSpecialtyPack,
  listSpecialtyPacks,
} from "./specialty-pack";

describe("resolveSpecialtyPack", () => {
  it("returns the Slovak general pack for ('sk', 'general')", () => {
    const pack = resolveSpecialtyPack("sk", "general");
    expect(pack.language).toBe("sk");
    expect(pack.specialty).toBe("general");
    expect(pack.diagnosisSynonyms["stemi"].icd).toBe("I21.3");
  });

  it("returns the Czech pack for ('cs')", () => {
    const pack = resolveSpecialtyPack("cs");
    expect(pack.language).toBe("cs");
    expect(pack.notStatedLabel).toBe("Neuvedeno");
  });

  it("falls back to language-general when specialty is unknown", () => {
    const pack = resolveSpecialtyPack("sk", "does_not_exist");
    expect(pack.specialty).toBe("general");
  });

  it("includes English allergy markers in symptom narrative list", () => {
    const pack = resolveSpecialtyPack("en");
    expect(pack.symptomNarrativeMarkers).toContain("chest pain");
    expect(pack.negationRenderingGuide).toMatch(/no <noun>/);
  });
});

describe("registerSpecialtyPack", () => {
  it("adds a new specialty-specific pack and resolveSpecialtyPack finds it", () => {
    registerSpecialtyPack({
      language: "sk",
      specialty: "cardiology-test",
      displayName: "Slovak — cardiology (test)",
      icdCsvPath: "public/icd-10/ICD-10-SK.csv",
      medicationCsvPath: null,
      diagnosisSynonyms: {
        "acute mi": {
          icd: "I21.9",
          canonical: "Acute MI, unspecified",
        },
      },
      differentialMarkers: [],
      chronicMarkers: [],
      historicalMarkers: [],
      symptomNarrativeMarkers: [],
      assessmentHeadingMarkers: [],
      allergyKeywordRegexSource: "alergi",
      negationRenderingGuide: "n/a",
      notStatedLabel: "—",
    });
    const pack = resolveSpecialtyPack("sk", "cardiology-test");
    expect(pack.specialty).toBe("cardiology-test");
    expect(pack.diagnosisSynonyms["acute mi"].icd).toBe("I21.9");
  });
});

describe("listSpecialtyPacks", () => {
  it("includes all built-in packs", () => {
    const packs = listSpecialtyPacks();
    expect(packs.some((p) => p.language === "sk")).toBe(true);
    expect(packs.some((p) => p.language === "cs")).toBe(true);
    expect(packs.some((p) => p.language === "en")).toBe(true);
  });
});
