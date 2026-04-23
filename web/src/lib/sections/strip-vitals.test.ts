// @vitest-environment node
import { describe, it, expect } from "vitest";
import { stripUngroundedVitalValue } from "./pipeline";
import type { RawSource } from "./section-agent";

function src(transcript: string, ...files: string[]): RawSource {
  return {
    transcript,
    files: files.map((text, i) => ({ name: `f${i}.txt`, text })),
  };
}

describe("stripUngroundedVitalValue", () => {
  it("passes through drafts with no digits untouched", () => {
    const draft = "Pravidelný, plný.";
    expect(stripUngroundedVitalValue(draft, src("irrelevant"))).toBe(draft);
  });

  it("passes through when every digit token is in the source", () => {
    const draft = "SF 68/min, pravidelný.";
    const source = src("SF 68/min, pravidelný.");
    expect(stripUngroundedVitalValue(draft, source)).toBe(draft);
  });

  it("strips when a digit token is absent from the source (voice-example leak)", () => {
    // Classic Pulz leak — source doesn't mention pulse values at all,
    // but the model emitted '68' anyway (carried over from corpus).
    const draft = "68/min, pravidelný.";
    const source = src("Pacient sa sťažuje na bolesť na hrudi.");
    expect(stripUngroundedVitalValue(draft, source)).toBe("");
  });

  it("strips when ANY digit in a compound value is missing", () => {
    const draft = "TK 135/80 mmHg.";
    // Source has 135 but not 80
    const source = src("TK 135 bolo ranné meranie.");
    expect(stripUngroundedVitalValue(draft, source)).toBe("");
  });

  it("accepts digits from any source channel (transcript / file)", () => {
    const draft = "BMI 32";
    const source = src(
      "doctor dictation without numbers",
      "# Lab results\nBMI: 32",
    );
    expect(stripUngroundedVitalValue(draft, source)).toBe("BMI 32");
  });

  it("handles decimal points as separate tokens", () => {
    const draft = "27.9";
    // Source has both integer parts separately.
    const source = src("BMI bol 27 a niečo, presne 27.9 podľa ECHO.");
    expect(stripUngroundedVitalValue(draft, source)).toBe("27.9");
  });

  it("tolerates substring-only matches (safe false-pass)", () => {
    // "32" is a substring of "2032" — we don't try to detect word
    // boundaries, so this passes. It's a conservative trade-off
    // that prevents false strips while still catching invented values.
    const draft = "BMI 32";
    const source = src("Rodné číslo 2032...");
    expect(stripUngroundedVitalValue(draft, source)).toBe("BMI 32");
  });

  it("returns empty draft unchanged", () => {
    expect(stripUngroundedVitalValue("", src("anything"))).toBe("");
    expect(stripUngroundedVitalValue("   ", src("anything"))).toBe("   ");
  });
});
