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
});
