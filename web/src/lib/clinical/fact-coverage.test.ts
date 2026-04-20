import { describe, it, expect } from "vitest";
import { checkFactCoverage } from "./fact-coverage";
import type { FactRef } from "./encounter-model";

function ref(id: string, value: string, negated = false): FactRef {
  return {
    id,
    value,
    category: "symptoms",
    source: { type: "transcript", sourceIndex: 0, evidence: value },
    ...(negated ? { negated: true as const } : {}),
  };
}

describe("checkFactCoverage — perfect recall", () => {
  it("passes when every fact's content tokens appear in the output", () => {
    const expected = {
      to: [
        ref("f1", "bolesť na hrudníku"),
        ref("f2", "dušnosť"),
        ref("f3", "slabosť"),
      ],
    };
    const rendered = {
      to: "Pacient udáva bolesť na hrudníku, dušnosť a slabosť.",
    };
    const report = checkFactCoverage({ expected, rendered });
    expect(report.passed).toBe(true);
    expect(report.dropped).toHaveLength(0);
  });

  it("allows grammatical variants (bolesť → bolesti)", () => {
    const expected = { to: [ref("f1", "bolesť na hrudníku")] };
    const rendered = { to: "Pacient udáva bolesti na hrudníku." };
    const report = checkFactCoverage({ expected, rendered });
    expect(report.passed).toBe(true);
  });
});

describe("checkFactCoverage — dropped facts", () => {
  it("flags a fact whose tokens are missing from the output", () => {
    const expected = {
      to: [
        ref("f1", "bolesť na hrudníku"),
        ref("f2", "vertigo"),
        ref("f3", "pokašľávanie"),
      ],
    };
    const rendered = {
      to: "Pacient udáva bolesť na hrudníku a pokašľávanie.",
    };
    const report = checkFactCoverage({ expected, rendered });
    expect(report.passed).toBe(false);
    expect(report.dropped.map((d) => d.fact.id)).toEqual(["f2"]);
  });

  it("catches Opus silently dropping a pertinent negative", () => {
    const expected = {
      to: [
        ref("f1", "bolesť na hrudníku"),
        ref("f2", "dušnosť", true), // negated
      ],
    };
    const rendered = { to: "Pacient udáva bolesť na hrudníku." }; // "bez dušnosti" omitted
    const report = checkFactCoverage({ expected, rendered });
    expect(report.passed).toBe(false);
    expect(report.dropped.map((d) => d.fact.id)).toContain("f2");
  });
});

describe("checkFactCoverage — threshold", () => {
  it("passes at 85% coverage by default", () => {
    const facts: FactRef[] = [];
    for (let i = 0; i < 10; i++) facts.push(ref(`f${i}`, `diagnóza${i}`));
    // Render 9 of 10 — 90% coverage (pass).
    const rendered = {
      to: "diagnóza0, diagnóza1, diagnóza2, diagnóza3, diagnóza4, diagnóza5, diagnóza6, diagnóza7, diagnóza8.",
    };
    const report = checkFactCoverage({ expected: { to: facts }, rendered });
    expect(report.passed).toBe(true);
  });

  it("fails under a stricter threshold when Opus drops even one fact", () => {
    const expected = {
      to: [
        ref("f1", "hypertenzia"),
        ref("f2", "diabetes"),
        ref("f3", "hyperurikémia"),
      ],
    };
    const rendered = { to: "hypertenzia a diabetes." }; // drops hyperurikémia
    const report = checkFactCoverage({
      expected,
      rendered,
      threshold: 1.0,
    });
    expect(report.passed).toBe(false);
  });
});

describe("checkFactCoverage — empty / edge cases", () => {
  it("passes trivially when no facts are expected", () => {
    const report = checkFactCoverage({
      expected: { to: [] },
      rendered: { to: "" },
    });
    expect(report.passed).toBe(true);
    expect(report.dropped).toHaveLength(0);
  });

  it("reports per-section stats", () => {
    const expected = {
      to: [ref("f1", "bolesť")],
      plan: [ref("f2", "kontrola")],
    };
    const rendered = {
      to: "pacient udáva bolesť.",
      plan: "kontrola lekárom do 3 dní.",
    };
    const report = checkFactCoverage({ expected, rendered });
    expect(report.perSection).toHaveLength(2);
    expect(report.perSection.every((s) => s.ratio === 1)).toBe(true);
  });
});
