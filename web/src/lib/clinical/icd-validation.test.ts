import { describe, it, expect } from "vitest";
import { validateIcdDescriptions } from "./icd-index";

describe("validateIcdDescriptions", () => {
  it("replaces hallucinated description with canonical SK description", () => {
    const input =
      "- I21.0 Akútny transmurálny infarkt prednej steny (STEMI laterálnej steny)";
    const result = validateIcdDescriptions(input, "sk");

    expect(result).toBe(
      "- I21.0 Akútny transmurálny infarkt myokardu prednej steny",
    );
  });

  it("replaces multiple ICD descriptions in bullet list", () => {
    const input = [
      "- I21.0 Nejaký vymyslený popis infarktu",
      "- I10 Hypertenzia bližšie neurčená",
    ].join("\n");

    const result = validateIcdDescriptions(input, "sk");

    expect(result).toContain(
      "- I21.0 Akútny transmurálny infarkt myokardu prednej steny",
    );
    expect(result).toContain(
      "- I10 Primárna [esenciálna] artériová hypertenzia",
    );
  });

  it("leaves text with non-ICD patterns unchanged", () => {
    // Lowercase letter won't match the ICD pattern [A-Z], so it's left alone
    const input = "- Pacient bol prepustený domov v stabilizovanom stave";
    const result = validateIcdDescriptions(input, "sk");

    expect(result).toBe(input);
  });

  it("does not replace codes that appear mid-sentence", () => {
    const input = "Podľa kódu I21.0 bol pacient diagnostikovaný so STEMI.";
    const result = validateIcdDescriptions(input, "sk");

    // Mid-sentence codes should not be touched
    expect(result).toBe(input);
  });

  it("handles code at line start without bullet marker", () => {
    const input = "I21.1 Nesprávny popis";
    const result = validateIcdDescriptions(input, "sk");

    expect(result).toBe(
      "I21.1 Akútny transmurálny infarkt myokardu spodnej steny",
    );
  });

  it("returns empty string unchanged", () => {
    expect(validateIcdDescriptions("", "sk")).toBe("");
  });

  it("returns text without ICD codes unchanged", () => {
    const input =
      "Pacient sa sťažuje na bolesti hlavy. Odporúča sa kontrola o 2 týždne.";
    expect(validateIcdDescriptions(input, "sk")).toBe(input);
  });

  it("handles mixed content — only replaces ICD lines", () => {
    const input = [
      "Pacient bol vyšetrený a diagnostikovaný:",
      "- I21.0 Vymyslený popis",
      "Odporúča sa ďalšie sledovanie.",
    ].join("\n");

    const result = validateIcdDescriptions(input, "sk");

    expect(result).toContain("Pacient bol vyšetrený a diagnostikovaný:");
    expect(result).toContain(
      "- I21.0 Akútny transmurálny infarkt myokardu prednej steny",
    );
    expect(result).toContain("Odporúča sa ďalšie sledovanie.");
  });

  it("works with category-level codes (no subcategory)", () => {
    const input = "- I21 Nejaký popis infarktu";
    const result = validateIcdDescriptions(input, "sk");

    expect(result).toBe("- I21 Akútny infarkt myokardu");
  });

  it("preserves bullet indentation", () => {
    const input = "  - I21.0 Zlý popis";
    const result = validateIcdDescriptions(input, "sk");

    expect(result).toContain("  - I21.0");
  });
});
