// @vitest-environment node
import { describe, it, expect } from "vitest";
import { drugNormalizer } from "./drug-normalizer";

const ctx = { language: "sk" as const };
const src = {};

describe("drug-normalizer", () => {
  it("leaves valid brand names untouched", () => {
    const input = "Rytmonorm 1-0-1\nNolpaza 1-0-0";
    expect(drugNormalizer(input, src, ctx)).toBe(input);
  });

  it("corrects a near-miss brand and preserves dose + frequency", () => {
    // "Paretic" is a common SK transcription of Paretin (paroxetine).
    const corrected = drugNormalizer("Paretic 1-0-0", src, ctx);
    expect(corrected.startsWith("Paretin")).toBe(true);
    expect(corrected).toContain("1-0-0");
  });

  it("handles multi-word brands (Betaloc ZOK 25 mg)", () => {
    const input = "Betaloc ZOK 25 mg, ráno";
    const out = drugNormalizer(input, src, ctx);
    // Valid → unchanged.
    expect(out).toBe(input);
  });

  it("handles dashed brand names (Co-Prenessa)", () => {
    const input = "Koprenesa 4 mg/1,25 mg, 1-0-0";
    const out = drugNormalizer(input, src, ctx);
    expect(out.toLowerCase()).toContain("prenessa");
    expect(out).toContain("1-0-0");
  });

  it("preserves lines with no drug prefix (empty or whitespace-only)", () => {
    const input = "\nRytmonorm 1-0-1\n\n";
    expect(drugNormalizer(input, src, ctx)).toBe(input);
  });

  it("leaves truly unknown products as-is (no false correction)", () => {
    // A made-up brand nowhere near the CSV — must be left alone.
    const input = "Zqxwvbrt 1-0-1";
    expect(drugNormalizer(input, src, ctx)).toBe(input);
  });

  it("processes multi-line text line-by-line", () => {
    const input = ["Rytmonorm 1-0-1", "Paretic 1-0-0", "Nolpaza 1-0-0"].join(
      "\n",
    );
    const out = drugNormalizer(input, src, ctx);
    const lines = out.split("\n");
    expect(lines[0]).toBe("Rytmonorm 1-0-1");
    expect(lines[1].startsWith("Paretin")).toBe(true);
    expect(lines[2]).toBe("Nolpaza 1-0-0");
  });

  it("returns empty text untouched", () => {
    expect(drugNormalizer("", src, ctx)).toBe("");
    expect(drugNormalizer("   \n  ", src, ctx)).toBe("   \n  ");
  });

  it("short-circuits ANP → ANOPYRIN via the abbreviation alias map (not fuzzy)", () => {
    // Without the alias, substring-matching hits "Anpharm" → wrong drug.
    const out = drugNormalizer("ANP 100 mg 0-1-0", src, ctx);
    expect(out).toBe("ANOPYRIN 100 mg 0-1-0");
    expect(out).not.toContain("Anpharm");
  });

  it("normalizes multiple meds on a SINGLE comma-separated line", () => {
    // New LA format: one line, comma-separated. Each entry must be
    // normalised independently.
    const input =
      "ANOPYRIN 100 mg, Paretic 1-0-0, ANP 100 mg 0-1-0, Rytmonorm 1-0-1";
    const out = drugNormalizer(input, src, ctx);
    expect(out).toContain("ANOPYRIN 100 mg");
    expect(out).toContain("Paretin"); // fuzzy correction
    expect(out).toContain("ANOPYRIN 100 mg 0-1-0"); // alias
    expect(out).not.toContain("Anpharm");
    expect(out).toContain("Rytmonorm 1-0-1");
  });

  it("does NOT split an internal decimal comma (Arixtra 2,5 mg)", () => {
    const input = "ANOPYRIN 100 mg, Arixtra 2,5 mg sc à 24h (15:00)";
    const out = drugNormalizer(input, src, ctx);
    // Arixtra's "2,5" must survive as a single entry — no phantom split.
    expect(out).toContain("Arixtra 2,5 mg sc à 24h (15:00)");
  });

  it("dedupes exact-duplicate drug entries (same brand + same dose)", () => {
    // Reproduces the real-world "TRITACE 1/3-0-0, TRITACE 1/3-0-0" bug.
    const input = "TRITACE 1/3-0-0, TRITACE 1/3-0-0, Zetovar";
    const out = drugNormalizer(input, src, ctx);
    const tritaceCount = (out.match(/TRITACE/gi) ?? []).length;
    expect(tritaceCount).toBe(1);
    expect(out).toContain("Zetovar");
  });

  it("keeps entries with same brand but DIFFERENT dose (not a duplicate)", () => {
    // Patient taking 2× same drug at different strengths is legitimate.
    const input = "TRITACE 1/3-0-0, TRITACE 1/2-0-0";
    const out = drugNormalizer(input, src, ctx);
    const tritaceCount = (out.match(/TRITACE/gi) ?? []).length;
    expect(tritaceCount).toBe(2);
  });

  it("dedupes across newlines, not just within a comma-separated line", () => {
    const input = "ANOPYRIN 100 mg 0-1-0\nANOPYRIN 100 mg 0-1-0";
    const out = drugNormalizer(input, src, ctx);
    const anopyrinCount = (out.match(/ANOPYRIN/gi) ?? []).length;
    expect(anopyrinCount).toBe(1);
  });

  it("dedup tolerates whitespace / case drift in dose schedule", () => {
    // " 1/3-0-0 " and "1/3-0-0" should fingerprint to the same value.
    const input = "TRITACE 1/3-0-0, tritace  1/3-0-0 ";
    const out = drugNormalizer(input, src, ctx);
    const tritaceCount = (out.match(/tritace/gi) ?? []).length;
    expect(tritaceCount).toBe(1);
  });
});
