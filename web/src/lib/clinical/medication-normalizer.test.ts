import { describe, it, expect } from "vitest";
import {
  parseMedicationFact,
  reconstructMedicationValue,
} from "./medication-normalizer";
import { correctMedicationBaseName } from "./medication-index";

describe("parseMedicationFact", () => {
  it("parses name + frequency pattern (no dose)", () => {
    const result = parseMedicationFact("Rytmonorm 1-0-1");
    expect(result.name).toBe("Rytmonorm");
    expect(result.frequency).toBe("1-0-1");
    expect(result.dose).toBeUndefined();
  });

  it("parses name + dose (no frequency)", () => {
    const result = parseMedicationFact("Eliquis 5 mg");
    expect(result.name).toBe("Eliquis");
    expect(result.dose).toBe("5 mg");
    expect(result.frequency).toBeUndefined();
  });

  it("parses name + dose + frequency", () => {
    const result = parseMedicationFact("Eliquis 2,5 mg 2x denne");
    expect(result.name).toBe("Eliquis");
    expect(result.dose).toBe("2,5 mg");
    expect(result.frequency).toBe("2x denne");
  });

  it("parses name only (no dose or frequency)", () => {
    const result = parseMedicationFact("Koprenesa");
    expect(result.name).toBe("Koprenesa");
    expect(result.dose).toBeUndefined();
    expect(result.frequency).toBeUndefined();
  });

  it("parses multi-word drug name + dose + frequency", () => {
    const result = parseMedicationFact("Betaloc ZOK 25 mg 1-0-0");
    expect(result.name).toBe("Betaloc ZOK");
    expect(result.dose).toBe("25 mg");
    expect(result.frequency).toBe("1-0-0");
  });

  it("parses name + frequency 'ráno'", () => {
    const result = parseMedicationFact("Euthyrox 25 mg ráno");
    expect(result.name).toBe("Euthyrox");
    expect(result.dose).toBe("25 mg");
    expect(result.frequency).toBe("ráno");
  });

  it("parses name + frequency 'na noc'", () => {
    const result = parseMedicationFact("Zolpidem 10 mg na noc");
    expect(result.name).toBe("Zolpidem");
    expect(result.dose).toBe("10 mg");
    expect(result.frequency).toBe("na noc");
  });

  it("parses route", () => {
    const result = parseMedicationFact("Heparin 5000 IU s.c.");
    expect(result.name).toBe("Heparin");
    expect(result.dose).toBe("5000 IU");
    expect(result.route).toBe("s.c.");
  });

  it("handles empty input", () => {
    const result = parseMedicationFact("");
    expect(result.name).toBe("");
  });

  it("handles dose with comma decimal (Slovak format)", () => {
    const result = parseMedicationFact("Warfarin 3,75 mg");
    expect(result.name).toBe("Warfarin");
    expect(result.dose).toBe("3,75 mg");
  });

  it("handles dose with dot decimal", () => {
    const result = parseMedicationFact("Warfarin 3.75 mg");
    expect(result.name).toBe("Warfarin");
    expect(result.dose).toBe("3.75 mg");
  });

  it("handles mcg / µg units", () => {
    const result = parseMedicationFact("Euthyrox 112 mcg");
    expect(result.name).toBe("Euthyrox");
    expect(result.dose).toBe("112 mcg");
  });

  it("handles four-segment frequency", () => {
    const result = parseMedicationFact("Metformin 500 mg 1-0-1-0");
    expect(result.name).toBe("Metformin");
    expect(result.dose).toBe("500 mg");
    expect(result.frequency).toBe("1-0-1-0");
  });
});

describe("reconstructMedicationValue", () => {
  it("reconstructs with corrected name, preserving dose and frequency", () => {
    const result = reconstructMedicationValue({
      name: "Koprenesa",
      dose: "5 mg",
      frequency: "1-0-1",
      correctedName: "Co-Prenessa",
    });
    expect(result).toBe("Co-Prenessa 5 mg 1-0-1");
  });

  it("reconstructs with original name when no correction", () => {
    const result = reconstructMedicationValue({
      name: "Rytmonorm",
      frequency: "1-0-1",
    });
    expect(result).toBe("Rytmonorm 1-0-1");
  });

  it("reconstructs name only", () => {
    const result = reconstructMedicationValue({
      name: "Aspirin",
    });
    expect(result).toBe("Aspirin");
  });

  it("includes route when present", () => {
    const result = reconstructMedicationValue({
      name: "Heparin",
      dose: "5000 IU",
      route: "s.c.",
      correctedName: "Heparin",
    });
    expect(result).toBe("Heparin 5000 IU s.c.");
  });

  it("includes remainder when present", () => {
    const result = reconstructMedicationValue({
      name: "Aspirin",
      dose: "100 mg",
      remainder: "tbl",
    });
    expect(result).toBe("Aspirin 100 mg tbl");
  });
});

describe("correctMedicationBaseName", () => {
  it("returns null for a valid medication (no correction needed)", () => {
    // "Rytmonorm" should be findable via substring search
    // (the CSV has entries starting with "Rytmonorm")
    const result = correctMedicationBaseName("Rytmonorm", "sk");
    // If the base name is already valid/findable, should return null
    // OR if it does return a correction, the corrected base should NOT
    // include dosage
    if (result !== null) {
      expect(result.correctedBaseName).not.toMatch(/\d+\s*(mg|ml|g|µg|mcg)/i);
    }
  });

  it("corrects misspelled name and returns only base name (no dosage)", () => {
    // "Koprenesa" is a transcription misspelling of "Co-Prenessa"
    const result = correctMedicationBaseName("Koprenesa", "sk");
    expect(result).not.toBeNull();
    if (result) {
      // Should return "Co-Prenessa", NOT "Co-Prenessa 4 mg /1,25 mg"
      expect(result.correctedBaseName).toContain("Co-Prenessa");
      expect(result.correctedBaseName).not.toMatch(/\d+\s*(mg|ml|g|µg|mcg)/i);
      expect(result.entry.activeIngredient).toBeTruthy();
    }
  });

  it("regression: corrected name never contains CSV dosage", () => {
    // This is the critical regression test. The old correctMedicationName()
    // returned "Rytmonorm 150 mg" — the new function must never do that.
    const names = ["Koprenesa", "Ritmunorm", "Elikviz"];
    for (const name of names) {
      const result = correctMedicationBaseName(name, "sk");
      if (result) {
        expect(result.correctedBaseName).not.toMatch(
          /\d+[,.]?\d*\s*(mg|ml|g|µg|mcg|iu|mikrogramov)/i,
        );
      }
    }
  });
});

describe("end-to-end: parse → correct → reconstruct", () => {
  it("'Koprenesa 1-0-1' → 'Co-Prenessa 1-0-1' (name fixed, schedule preserved)", () => {
    const parsed = parseMedicationFact("Koprenesa 1-0-1");
    expect(parsed.name).toBe("Koprenesa");
    expect(parsed.frequency).toBe("1-0-1");

    const correction = correctMedicationBaseName(parsed.name, "sk");
    expect(correction).not.toBeNull();

    if (correction) {
      const reconstructed = reconstructMedicationValue({
        ...parsed,
        correctedName: correction.correctedBaseName,
      });
      expect(reconstructed).toContain("Co-Prenessa");
      expect(reconstructed).toContain("1-0-1");
      expect(reconstructed).not.toMatch(/\d+\s*mg/i);
    }
  });

  it("'Rytmonorm 1-0-1' stays unchanged (no CSV dosage injected)", () => {
    const parsed = parseMedicationFact("Rytmonorm 1-0-1");
    const correction = correctMedicationBaseName(parsed.name, "sk");

    // Either no correction needed, or correction is the same base name
    if (correction === null) {
      // No correction needed — value stays as-is
      const reconstructed = reconstructMedicationValue(parsed);
      expect(reconstructed).toBe("Rytmonorm 1-0-1");
    } else {
      // Corrected — but must NOT contain "150 mg"
      const reconstructed = reconstructMedicationValue({
        ...parsed,
        correctedName: correction.correctedBaseName,
      });
      expect(reconstructed).toContain("1-0-1");
      expect(reconstructed).not.toContain("150 mg");
    }
  });

  it("'Eliquis 5 mg' does NOT become 'Eliquis 2,5 mg'", () => {
    const parsed = parseMedicationFact("Eliquis 5 mg");
    expect(parsed.dose).toBe("5 mg");

    const correction = correctMedicationBaseName(parsed.name, "sk");

    if (correction) {
      const reconstructed = reconstructMedicationValue({
        ...parsed,
        correctedName: correction.correctedBaseName,
      });
      expect(reconstructed).toContain("5 mg");
      expect(reconstructed).not.toContain("2,5 mg");
    } else {
      // No correction — original preserved
      const reconstructed = reconstructMedicationValue(parsed);
      expect(reconstructed).toBe("Eliquis 5 mg");
    }
  });
});
