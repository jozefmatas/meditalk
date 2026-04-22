// @vitest-environment node
import { describe, it, expect } from "vitest";
import { icdValidator } from "./icd-validator";

const ctx = { language: "sk" as const };
const src = {};

describe("icd-validator", () => {
  it("normalizes no-dot codes — R074 → R07.4", () => {
    const out = icdValidator(
      "R074 Bolesť v hrudníku, bližšie neurčená",
      src,
      ctx,
    );
    expect(out.startsWith("R07.4")).toBe(true);
  });

  it("does NOT double the description when CSV canonical contains a comma", () => {
    // R07.4 canonical is "Bolesť v hrudníku, bližšie neurčená" — a comma
    // INSIDE the description used to break the old comma-splitter, producing
    // "Bolesť v hrudníku, bližšie neurčená, bližšie neurčená". The new
    // code-boundary splitter replaces the whole description, no fragment
    // leaks out as a second pseudo-entry.
    const input = "R074 Bolesť v hrudníku, bližšie neurčená";
    const out = icdValidator(input, src, ctx);
    const count = (out.match(/bližšie neurčená/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("does NOT duplicate a parenthetical the CSV canonical already carries (MGUS)", () => {
    // D47.2 canonical is "Monoklonová gamapatia nejasného významu (MGUS)".
    // The input also ends with "(MGUS)" because the suggester included it.
    // Without the parenIsRedundant guard we'd emit "… (MGUS) (MGUS)".
    const input = "D47.2 Monoklonová gamapatia nejasného významu (MGUS)";
    const out = icdValidator(input, src, ctx);
    const count = (out.match(/\(MGUS\)/g) ?? []).length;
    expect(count).toBe(1);
    expect(out).toContain("D47.2");
  });

  it("replaces an agent-paraphrased description with the CSV canonical", () => {
    const input = "I10 Esenciálna hypertenzia stupňa 3";
    const out = icdValidator(input, src, ctx);
    expect(out).toContain("I10");
    expect(out).toContain("Primárna");
    expect(out).not.toContain("stupňa 3");
  });

  it("handles bulleted lines (preserves the bullet prefix)", () => {
    const input = "- I21.4 Akútny subendokardiálny infarkt myokardu";
    const out = icdValidator(input, src, ctx);
    expect(out.startsWith("-")).toBe(true);
    expect(out).toContain("I21.4");
  });

  it("handles multiple newline-separated ICD lines", () => {
    const input = [
      "I21.4 Akútny subendokardiálny infarkt myokardu",
      "I10 Esenciálna hypertenzia",
      "R074 Bolesť v hrudníku",
    ].join("\n");
    const out = icdValidator(input, src, ctx);
    const lines = out.split("\n");
    expect(lines[0]).toContain("I21.4");
    expect(lines[1]).toContain("I10");
    expect(lines[2].startsWith("R07.4")).toBe(true);
  });

  it("handles comma-separated ICD entries on one line", () => {
    const input =
      "I21.4 Akútny subendokardiálny infarkt myokardu, I10 Esenciálna hypertenzia, R074 Bolesť v hrudníku";
    const out = icdValidator(input, src, ctx);
    expect(out).toContain("I21.4");
    expect(out).toContain("I10");
    expect(out).toContain("R07.4");
    expect((out.match(/I21\.4|I10\b|R07\.4/g) ?? []).length).toBe(3);
  });

  it("preserves parenthetical differential clauses on the primary entry", () => {
    const input =
      "R074 Bolesť v hrudníku (diferenciálna dg.: nemožno vylúčiť IAP, NSTEMI), I10 Esenciálna hypertenzia";
    const out = icdValidator(input, src, ctx);
    expect(out).toContain("R07.4");
    expect(out).toContain("I10");
    expect(out).toContain("diferenciálna dg.:");
    expect(out).toContain("IAP, NSTEMI");
  });

  it("keeps a valid 2-digit-decimal Slovak code (e.g. I25.10) as-is", () => {
    // I25.10 IS in the Slovak ICD CSV ("Aterosklerotická choroba srdca,
    // bez hemodynamicky závažných stenóz"). The validator should
    // preserve the code and use the CSV canonical description.
    const out = icdValidator("I25.10 Aterosklerotická choroba srdca", src, ctx);
    expect(out).toContain("I25.10");
    expect(out).toMatch(/Aterosklerotická choroba srdca/i);
  });

  it("drops an ICD-10-CM-shaped code (3+ decimal digits) not in CSV", () => {
    // Z87.891 is US ICD-10-CM (personal history of other specified),
    // absent from Slovak CSV. Its 3-char root Z87 in SK canonicalises as
    // "respiratory diseases in personal history" — completely unrelated
    // to the agent's intent. Drop rather than ship a misleading entry.
    const input = "Z87.891 Stav po inom výkone, I10 Hypertenzia";
    const out = icdValidator(input, src, ctx);
    expect(out).not.toContain("Z87.891");
    // The clean I10 entry still ships.
    expect(out).toContain("I10");
  });

  it("downgrades a 1-2 digit-decimal code to root when root is in CSV", () => {
    // H61.20 isn't in the Slovak CSV. Root H61 IS (disorders of external
    // ear). The agent mis-used H61.20 for gynekomastia. The validator
    // downgrades: H61.20 → H61 with its real Slovak canonical. The
    // clinician sees an obviously-wrong code and can fix; better than
    // silent acceptance of a wrong code-description pair.
    const out = icdValidator("H61.20 Gynekomastia bilaterálna", src, ctx);
    expect(out).not.toContain("H61.20");
    expect(out).toMatch(/\bH61\b/);
    // CSV canonical replaces the agent's mislabel.
    expect(out).not.toContain("Gynekomastia");
  });

  it("drops a totally-unknown CM-shaped code while preserving neighbours", () => {
    const input = "X99.999 Nothing, I10 Hypertenzia";
    const out = icdValidator(input, src, ctx);
    expect(out).not.toContain("X99.999");
    expect(out).toContain("I10");
  });

  it("leaves non-ICD text unchanged", () => {
    const input = "Hlavná diagnóza\nDiferenciálna diagnostika";
    expect(icdValidator(input, src, ctx)).toBe(input);
  });

  it("leaves empty text untouched", () => {
    expect(icdValidator("", src, ctx)).toBe("");
    expect(icdValidator("   \n", src, ctx)).toBe("   \n");
  });

  it("preserves a trailing period if the agent ended with one", () => {
    const input = "I10 Esenciálna hypertenzia.";
    const out = icdValidator(input, src, ctx);
    expect(out.trim().endsWith(".")).toBe(true);
  });
});
