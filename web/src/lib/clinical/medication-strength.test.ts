import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeStrength,
  getValidStrengthsForBase,
  validateMedicationStrength,
  __resetMedicationStrengthCache,
  __internal_extractStrengthFromName,
} from "./medication-strength";

beforeEach(() => __resetMedicationStrengthCache());

describe("normalizeStrength", () => {
  it("lowercases, strips whitespace, converts decimal comma", () => {
    expect(normalizeStrength("2,5 mg")).toBe("2.5mg");
    expect(normalizeStrength("5 MG")).toBe("5mg");
    expect(normalizeStrength("  150 mg  ")).toBe("150mg");
  });

  it("preserves combo-drug separators", () => {
    expect(normalizeStrength("2,5 mg /1,25 mg")).toBe("2.5mg/1.25mg");
    expect(normalizeStrength("8 mg/10 mg")).toBe("8mg/10mg");
  });

  it("returns null for empty / number-less input", () => {
    expect(normalizeStrength("")).toBeNull();
    expect(normalizeStrength("tablety")).toBeNull();
    expect(normalizeStrength("  ")).toBeNull();
  });
});

describe("__internal_extractStrengthFromName", () => {
  it("pulls strength from simple single-component name", () => {
    expect(__internal_extractStrengthFromName("Atacand 16 mg")).toBe("16 mg");
  });

  it("pulls combo strength", () => {
    expect(__internal_extractStrengthFromName("Atacand Plus 16/12,5 mg")).toBe(
      "16/12,5 mg",
    );
  });

  it("stops before dosage-form keyword", () => {
    expect(
      __internal_extractStrengthFromName("Amlessa 8 mg/10 mg tablety"),
    ).toBe("8 mg/10 mg");
    expect(
      __internal_extractStrengthFromName("Abilify Maintena 400 mg prášok"),
    ).toBe("400 mg");
  });

  it("returns empty string for no-dose names", () => {
    expect(__internal_extractStrengthFromName("Rytmonorm")).toBe("");
  });
});

describe("getValidStrengthsForBase (SK CSV)", () => {
  it("finds all three Atacand strengths", () => {
    const strengths = getValidStrengthsForBase("Atacand", "sk");
    // Order may not be deterministic; use sorted comparison
    const sorted = [...strengths].sort();
    expect(sorted).toEqual(["16mg", "32mg", "8mg"].sort());
  });

  it("distinguishes Atacand from Atacand Plus", () => {
    const plus = getValidStrengthsForBase("Atacand Plus", "sk");
    expect(plus.length).toBeGreaterThan(0);
    // Make sure we didn't accidentally fold plus variants into base
    const base = getValidStrengthsForBase("Atacand", "sk");
    for (const s of plus) expect(base).not.toContain(s);
  });

  it("is case-insensitive on base name", () => {
    expect(getValidStrengthsForBase("atacand", "sk").length).toBeGreaterThan(0);
    expect(getValidStrengthsForBase("ATACAND", "sk").length).toBeGreaterThan(0);
  });

  it("returns empty array for unknown drug", () => {
    expect(getValidStrengthsForBase("Totallyfakedrug", "sk")).toEqual([]);
  });
});

describe("validateMedicationStrength", () => {
  it("returns ok with 'no_dose_stated' when dose is absent", () => {
    const v = validateMedicationStrength("Atacand", undefined, "sk");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.reason).toBe("no_dose_stated");
  });

  it("returns ok with 'no_dose_stated' when dose is whitespace / number-less", () => {
    expect(validateMedicationStrength("Atacand", "   ", "sk").ok).toBe(true);
    expect(validateMedicationStrength("Atacand", "tablety", "sk").ok).toBe(
      true,
    );
  });

  it("returns ok with 'strength_matches' for real Atacand dose", () => {
    const v = validateMedicationStrength("Atacand", "16 mg", "sk");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.reason).toBe("strength_matches");
  });

  it("returns ok with 'drug_unknown' for drugs not in CSV", () => {
    const v = validateMedicationStrength("Totallyfakedrug", "5 mg", "sk");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.reason).toBe("drug_unknown");
  });

  it("returns suspicious for invalid Atacand strength (500 mg)", () => {
    const v = validateMedicationStrength("Atacand", "500 mg", "sk");
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.severity).toBe("suspicious");
      expect(v.reason).toBe("invalid_strength");
      expect(v.validStrengths.length).toBeGreaterThan(0);
      expect(v.validStrengths.some((s) => s.includes("mg"))).toBe(true);
    }
  });

  it("handles Slovak decimal comma in input", () => {
    // Co-Prenessa 4 mg /1,25 mg — the CSV uses comma
    const v = validateMedicationStrength("Co-Prenessa", "4 mg /1.25 mg", "sk");
    // Shouldn't be 'invalid_strength' just because of comma vs dot
    if (!v.ok) {
      // If this drug isn't in the CSV, that's fine — but it must NOT be
      // reported as an invalid strength mismatch.
      expect(v.severity).not.toBe("suspicious");
    }
  });

  it("is case-insensitive on dose", () => {
    const v = validateMedicationStrength("Atacand", "16 MG", "sk");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.reason).toBe("strength_matches");
  });
});
