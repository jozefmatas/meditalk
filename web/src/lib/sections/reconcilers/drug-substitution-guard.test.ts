// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { drugSubstitutionGuard } from "./drug-substitution-guard";
import type { RawSource } from "../section-agent";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

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

  it("uses originalText (pre-file-focus) when file text already has substitution", () => {
    // Simulates the stale-cache scenario: file-focus extracted passages
    // with Haiku's substituted drug names. The file's `text` says "Fokusin"
    // but the original OCR text (`originalText`) says "Tamsulosín".
    const source: RawSource = {
      files: [
        {
          name: "dg-a-medikacia.pdf",
          text: "Fokusin 0,4 mg 0-0-1\nXarelto 20 mg 1-0-0",
          originalText:
            "Tamsulosín 0,4 mg 0-0-1\nXarelto 20 mg 1-0-0\nPrenessa 4 mg 1-0-0",
        },
      ],
    };
    const draft =
      "Fokusin 0,4 mg 0-0-1\nXarelto 20 mg 1-0-0\nCo-Prenessa 4 mg 1-0-0";

    const out = drugSubstitutionGuard(draft, source, ctx);
    expect(out).toContain("Tamsulosín");
    expect(out).not.toContain("Fokusin");
    expect(out).toContain("Xarelto 20 mg 1-0-0");
    expect(out).toContain("Prenessa");
    expect(out).not.toContain("Co-Prenessa");
  });
});
