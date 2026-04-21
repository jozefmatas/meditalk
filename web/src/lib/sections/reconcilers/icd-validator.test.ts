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

  it("leaves canonical codes with correct description untouched (except whitespace)", () => {
    // I10 in SK CSV: "Primárna [esenciálna] artériová hypertenzia"
    const input = "I10 Primárna [esenciálna] artériová hypertenzia";
    const out = icdValidator(input, src, ctx);
    expect(out).toContain("I10");
    expect(out).toContain("Primárna");
  });

  it("replaces an agent-paraphrased description with the CSV canonical", () => {
    // Agent wrote a paraphrase — reconciler should restore the canonical.
    const input = "I10 Esenciálna hypertenzia (paraphrased)";
    const out = icdValidator(input, src, ctx);
    // Must contain the code and the output should NOT still say "paraphrased".
    expect(out).toContain("I10");
    expect(out.toLowerCase()).not.toContain("paraphrased");
  });

  it("handles bulleted lines", () => {
    const input = "- I21.4 Akútny subendokardiálny infarkt myokardu";
    const out = icdValidator(input, src, ctx);
    expect(out.startsWith("-")).toBe(true);
    expect(out).toContain("I21.4");
  });

  it("handles multiple ICD lines in one section", () => {
    const input = [
      "I21.4 Akútny subendokardiálny infarkt myokardu",
      "I10 Esenciálna hypertenzia",
      "R074 Bolesť v hrudníku",
    ].join("\n");
    const out = icdValidator(input, src, ctx);
    const lines = out.split("\n");
    expect(lines[0]).toContain("I21.4");
    expect(lines[1]).toContain("I10");
    // R074 normalized to R07.4
    expect(lines[2].startsWith("R07.4")).toBe(true);
  });

  it("leaves non-ICD lines unchanged", () => {
    const input = "Hlavná diagnóza\nDiferenciálna diagnostika";
    expect(icdValidator(input, src, ctx)).toBe(input);
  });

  it("leaves empty text untouched", () => {
    expect(icdValidator("", src, ctx)).toBe("");
    expect(icdValidator("   \n", src, ctx)).toBe("   \n");
  });

  it("preserves unknown-to-CSV codes but keeps the agent's description", () => {
    // Synthetic code unlikely to be in the CSV.
    const input = "Z99.99 Synthetic test description";
    const out = icdValidator(input, src, ctx);
    expect(out).toContain("Z99.99");
    // Description preserved (CSV has no canonical for this).
    expect(out).toContain("Synthetic");
  });
});
