// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fixKnownMedicalTypos } from "./pipeline";

describe("fixKnownMedicalTypos", () => {
  it("fixes 'hemtóm' to 'hematóm' in the middle of prose", () => {
    const input =
      "viedlo k rozsiahlemu hemtómu s trvaním približne dva až tri mesiace";
    const out = fixKnownMedicalTypos(input);
    expect(out).toContain("hematómu");
    expect(out).not.toContain("hemtómu");
  });

  it("preserves leading capitalization", () => {
    expect(fixKnownMedicalTypos("Hemtóm v oblasti stehna")).toBe(
      "Hematóm v oblasti stehna",
    );
    expect(fixKnownMedicalTypos("hemtóm v oblasti stehna")).toBe(
      "hematóm v oblasti stehna",
    );
  });

  it("handles Slovak case endings (hemtómu, hemtómom)", () => {
    expect(fixKnownMedicalTypos("obavy z hemtómu")).toContain("hematómu");
    expect(fixKnownMedicalTypos("bol spôsobený hemtómom")).toContain(
      "hematómom",
    );
  });

  it("fixes multiple typos in one pass", () => {
    const input = "infrkt myokardu + hemtóm po intervencii";
    const out = fixKnownMedicalTypos(input);
    expect(out).toContain("infarkt");
    expect(out).toContain("hematóm");
  });

  it("leaves clean text untouched", () => {
    const input =
      "Pacient so známou ischemickou chorobou srdca, bol prijatý na naše pracovisko.";
    expect(fixKnownMedicalTypos(input)).toBe(input);
  });

  it("leaves empty text untouched", () => {
    expect(fixKnownMedicalTypos("")).toBe("");
    expect(fixKnownMedicalTypos("   ")).toBe("   ");
  });

  it("does not fold legitimate words that contain a typo stem as substring", () => {
    // "dyspnoe" is legit; we replace "dyspoe" → "dyspnoe". Verify the
    // correction doesn't loop or mangle already-correct text.
    const input = "dyspnoe bez ortopnoe";
    expect(fixKnownMedicalTypos(input)).toBe(input);
  });
});
