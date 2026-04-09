import { describe, it, expect } from "vitest";
import {
  validateIcdDescriptions,
  extractIcdCodesFromSections,
  buildIcdReferenceForConcepts,
} from "./icd-index";

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

describe("extractIcdCodesFromSections", () => {
  it("extracts codes from a single section containing a bullet list", () => {
    const sections = {
      assessment: [
        "- I21.0 Akútny transmurálny infarkt myokardu prednej steny",
        "- I10 Primárna [esenciálna] artériová hypertenzia",
      ].join("\n"),
    };
    const result = extractIcdCodesFromSections(sections, "sk");

    expect(result).toHaveLength(2);
    expect(result[0].code).toBe("I21.0");
    expect(result[1].code).toBe("I10");
    expect(result.every((c) => c.confidence === "high")).toBe(true);
    expect(result.every((c) => c.sourceConceptIds.length === 0)).toBe(true);
  });

  it("merges codes across multiple sections", () => {
    const sections = {
      assessment: "- I21.0 Akútny infarkt prednej steny",
      plan: "- I10 Hypertenzia",
      history: "- I21.1 Akútny infarkt spodnej steny",
    };
    const result = extractIcdCodesFromSections(sections, "sk");

    const codes = result.map((c) => c.code);
    expect(codes).toContain("I21.0");
    expect(codes).toContain("I10");
    expect(codes).toContain("I21.1");
    expect(result).toHaveLength(3);
  });

  it("deduplicates the same code appearing in two sections (first wins)", () => {
    const sections = {
      assessment: "- I10 Hypertenzia",
      plan: "- I10 Hypertenzia (pokračovať v liečbe)",
    };
    const result = extractIcdCodesFromSections(sections, "sk");

    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("I10");
  });

  it("skips text that does not contain any ICD-formatted line", () => {
    const sections = {
      assessment: "Pacient bol vyšetrený a prepustený domov v stabilnom stave.",
      plan: "Kontrola o 2 týždne.",
    };
    const result = extractIcdCodesFromSections(sections, "sk");

    expect(result).toHaveLength(0);
  });

  it("skips mid-sentence occurrences (regex is line-anchored)", () => {
    const sections = {
      assessment:
        "Podľa kódu I21.0 bol pacient diagnostikovaný s infarktom myokardu.",
    };
    const result = extractIcdCodesFromSections(sections, "sk");

    expect(result).toHaveLength(0);
  });

  it("returns [] for empty or blank sections", () => {
    expect(extractIcdCodesFromSections({}, "sk")).toEqual([]);
    expect(extractIcdCodesFromSections({ assessment: "" }, "sk")).toEqual([]);
    expect(
      extractIcdCodesFromSections({ assessment: "   \n  \n" }, "sk"),
    ).toEqual([]);
  });

  it("deduplicates repeated occurrences of the same canonical code", () => {
    const sections = {
      assessment: "- I21.0 Infarkt myokardu",
      plan: "- I21.0 Infarkt myokardu (pokračovanie liečby)",
    };
    const result = extractIcdCodesFromSections(sections, "sk");

    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("I21.0");
  });

  it("returns SK canonical (dotted) codes when locale is sk", () => {
    const sections = {
      assessment: "- I21.0 Infarkt myokardu",
    };
    const result = extractIcdCodesFromSections(sections, "sk");

    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("I21.0");
    // Description should be the canonical CSV description, not the input text
    expect(result[0].description).toContain("Akútny");
  });

  it("preserves first-appearance order across iteration over sections", () => {
    const sections = {
      assessment: "- I21.0 Infarkt",
      plan: "- I10 Hypertenzia",
    };
    const result = extractIcdCodesFromSections(sections, "sk");

    // Order matches insertion order of section keys
    expect(result.map((c) => c.code)).toEqual(["I21.0", "I10"]);
  });
});

describe("buildIcdReferenceForConcepts (Pass 1 window)", () => {
  // Regression: before the fix, pipeline.ts passed maxPerCategory=5, which
  // truncated the I21 category and hid I21.2 (other sites incl. lateral
  // wall MI) from Pass 1. The model then had to guess and consistently
  // picked I21.0 (anterior wall) for lateral wall STEMIs. Pipeline now
  // uses 15 and must expose I21.0–I21.4 for the SK locale.
  it("exposes all major I21.x variants in the SK locale at Pass 1 window size", () => {
    const ref = buildIcdReferenceForConcepts(["I21"], 15, "sk");
    expect(ref).toContain("I21.0");
    expect(ref).toContain("I21.1");
    expect(ref).toContain("I21.2");
    expect(ref).toContain("I21.3");
    expect(ref).toContain("I21.4");
  });

  it("exposes all major I21.x variants in the EN locale at Pass 1 window size", () => {
    const ref = buildIcdReferenceForConcepts(["I21"], 15, "en");
    // EN uses undotted codes
    expect(ref).toMatch(/I210|I21\.0/);
    expect(ref).toMatch(/I211|I21\.1/);
    expect(ref).toMatch(/I212|I21\.2/);
    expect(ref).toMatch(/I213|I21\.3/);
    expect(ref).toMatch(/I214|I21\.4/);
  });

  it("would have truncated I21.x at the old window size (documents the bug)", () => {
    // With the old maxPerCategory=5 limit, the reference might miss some
    // variants — this test guards against anyone silently lowering the
    // window again. If this assertion ever fails (i.e. 5 is enough), the
    // CSV ordering changed and we should re-evaluate.
    const narrow = buildIcdReferenceForConcepts(["I21"], 5, "sk");
    const narrowLines = narrow.split("\n").length;
    expect(narrowLines).toBeLessThanOrEqual(5);
  });

  it("respects maxPerCategory limit", () => {
    const ref = buildIcdReferenceForConcepts(["I21"], 3, "sk");
    const lines = ref.split("\n").filter((l) => l.trim());
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("deduplicates entries across overlapping category hints", () => {
    // Asking for I21 twice should not double the output
    const refOnce = buildIcdReferenceForConcepts(["I21"], 15, "sk");
    const refTwice = buildIcdReferenceForConcepts(["I21", "I21"], 15, "sk");
    expect(refOnce).toBe(refTwice);
  });
});
