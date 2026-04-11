import { describe, it, expect } from "vitest";
import {
  fuzzySearchMedications,
  correctMedicationName,
} from "./medication-index";

describe("fuzzySearchMedications", () => {
  it("finds Co-Prenessa from misspelling 'Koprenesa' (sk)", () => {
    const results = fuzzySearchMedications("Koprenesa", 3, "sk");
    expect(results.length).toBeGreaterThan(0);
    const names = results.map((r) => r.name);
    expect(names.some((n) => n.startsWith("Co-Prenessa"))).toBe(true);
  });

  it("finds medications from minor misspellings (sk)", () => {
    // "Amlodipin" is close to various "Amlodipín" entries
    const results = fuzzySearchMedications("Amlodipin", 3, "sk");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty for very short queries", () => {
    const results = fuzzySearchMedications("Ab", 3, "sk");
    expect(results).toHaveLength(0);
  });

  it("returns empty for completely unrelated strings", () => {
    const results = fuzzySearchMedications("ZxywqNotADrug", 3, "sk");
    expect(results).toHaveLength(0);
  });

  it("returns results sorted by similarity (highest first)", () => {
    const results = fuzzySearchMedications("Koprenesa", 5, "sk");
    if (results.length > 1) {
      for (let i = 1; i < results.length; i++) {
        expect(results[i].similarity).toBeLessThanOrEqual(
          results[i - 1].similarity,
        );
      }
    }
  });
});

describe("correctMedicationName", () => {
  it("corrects 'Koprenesa' → 'Co-Prenessa ...' (sk)", () => {
    const result = correctMedicationName("Koprenesa", "sk");
    expect(result).not.toBeNull();
    expect(result!.correctedName).toContain("Co-Prenessa");
    expect(result!.entry.activeIngredient).toBeTruthy();
  });

  it("returns null for exact matches (no correction needed)", () => {
    // "Co-Prenessa 4 mg /1,25 mg" is in the CSV — no correction needed
    const result = correctMedicationName("Co-Prenessa 4 mg /1,25 mg", "sk");
    expect(result).toBeNull();
  });

  it("returns null for completely unknown medications", () => {
    const result = correctMedicationName("ObviouslyFakeNotARealDrug", "sk");
    expect(result).toBeNull();
  });

  it("prefers substring matches over fuzzy matches", () => {
    // "Prenessa" is a substring of "Co-Prenessa" — should find via substring
    const result = correctMedicationName("Prenessa", "sk");
    expect(result).not.toBeNull();
    expect(result!.correctedName).toContain("Prenessa");
  });
});
