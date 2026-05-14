// @vitest-environment node
import { describe, it, expect } from "vitest";
import { drugSubstitutionGuard } from "./drug-substitution-guard";
import type { RawSource } from "../section-agent";

const ctx = { language: "sk" as const };

function sourceWithFiles(...texts: string[]): RawSource {
  return {
    files: texts.map((t, i) => ({ name: `file-${i}.pdf`, text: t })),
  };
}

describe("drug-substitution-guard", () => {
  it("reverts generic→brand substitution (Tamsulosín → Fokusin)", () => {
    const source = sourceWithFiles("Tamsulosín 0,4 mg 0-0-1");
    const draft = "Fokusin 0,4 mg 0-0-1";

    const out = drugSubstitutionGuard(draft, source, ctx);
    expect(out).toContain("Tamsulosín");
    expect(out).not.toContain("Fokusin");
    expect(out).toContain("0,4 mg 0-0-1");
  });

  it("reverts brand→combination-brand substitution (Prenessa → Co-Prenessa)", () => {
    const source = sourceWithFiles("Prenessa 4 mg 1-0-0");
    const draft = "Co-Prenessa 4 mg 1-0-0";

    const out = drugSubstitutionGuard(draft, source, ctx);
    expect(out).toContain("Prenessa");
    expect(out).not.toContain("Co-Prenessa");
    expect(out).toContain("4 mg 1-0-0");
  });

  it("leaves drugs that already match the source unchanged", () => {
    const source = sourceWithFiles(
      "Xarelto 20 mg 1-0-0\nBetaloc ZOK 25 mg 1-0-0\nRytmonorm 150 mg 1-1-1",
    );
    const draft =
      "Xarelto 20 mg 1-0-0\nBetaloc ZOK 25 mg 1-0-0\nRytmonorm 150 mg 1-1-1";

    const out = drugSubstitutionGuard(draft, source, ctx);
    expect(out).toBe(draft);
  });

  it("handles multiple substitutions in one text", () => {
    const source = sourceWithFiles(
      "Tamsulosín 0,4 mg 0-0-1\nPrenessa 4 mg 1-0-0\nXarelto 20 mg 1-0-0",
    );
    const draft =
      "Fokusin 0,4 mg 0-0-1\nCo-Prenessa 4 mg 1-0-0\nXarelto 20 mg 1-0-0";

    const out = drugSubstitutionGuard(draft, source, ctx);
    expect(out).toContain("Tamsulosín");
    expect(out).not.toContain("Fokusin");
    expect(out).toContain("Prenessa");
    expect(out).not.toContain("Co-Prenessa");
    // Xarelto stays unchanged
    expect(out).toContain("Xarelto 20 mg 1-0-0");
  });

  it("reads drug names from transcript and doctor notes too", () => {
    const source: RawSource = {
      transcript: "pacient berie Tamsulosín 0,4 mg",
      doctorNotes: "Prenessa 4 mg",
      files: [],
    };
    const draft = "Fokusin 0,4 mg 0-0-1\nCo-Prenessa 4 mg 1-0-0";

    const out = drugSubstitutionGuard(draft, source, ctx);
    expect(out).toContain("Tamsulosín");
    expect(out).not.toContain("Fokusin");
    expect(out).toContain("Prenessa");
    expect(out).not.toContain("Co-Prenessa");
  });

  it("returns empty/whitespace text unchanged", () => {
    const source = sourceWithFiles("Tamsulosín 0,4 mg 0-0-1");
    expect(drugSubstitutionGuard("", source, ctx)).toBe("");
    expect(drugSubstitutionGuard("  \n  ", source, ctx)).toBe("  \n  ");
  });

  it("returns text unchanged when source is empty", () => {
    const draft = "Fokusin 0,4 mg 0-0-1";
    const out = drugSubstitutionGuard(draft, {}, ctx);
    expect(out).toBe(draft);
  });
});
