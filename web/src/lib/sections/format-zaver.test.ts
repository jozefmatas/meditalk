// @vitest-environment node
import { describe, it, expect } from "vitest";
import { formatZaverFromSuggestions } from "./format-zaver";
import type { SuggestedIcdCode } from "./suggest-icd";

function code(
  c: string,
  d: string,
  confidence: "high" | "medium" | "low" = "high",
  differential?: string,
): SuggestedIcdCode {
  return { code: c, description: d, confidence, differential };
}

describe("formatZaverFromSuggestions", () => {
  it("returns empty string for empty input", () => {
    expect(formatZaverFromSuggestions([])).toBe("");
  });

  it("renders a single primary code with trailing period", () => {
    const out = formatZaverFromSuggestions([
      code("I21.4", "Akútny subendokardiálny infarkt myokardu"),
    ]);
    expect(out).toBe("I21.4 Akútny subendokardiálny infarkt myokardu.");
  });

  it("comma-joins primary + secondaries", () => {
    const out = formatZaverFromSuggestions([
      code("I21.4", "Akútny subendokardiálny infarkt myokardu"),
      code("I10", "Primárna [esenciálna] artériová hypertenzia"),
      code("K57.3", "Divertikulóza sigmy"),
    ]);
    expect(out).toBe(
      "I21.4 Akútny subendokardiálny infarkt myokardu, I10 Primárna [esenciálna] artériová hypertenzia, K57.3 Divertikulóza sigmy.",
    );
  });

  it("attaches the differential clause on the PRIMARY only", () => {
    const out = formatZaverFromSuggestions([
      code(
        "R07.4",
        "Bolesť v hrudníku, bližšie neurčená",
        "high",
        "nemožno vylúčiť NSTEMI, nestabilnú angínu pectoris",
      ),
      code("I10", "Primárna [esenciálna] artériová hypertenzia"),
    ]);
    expect(out).toBe(
      "R07.4 Bolesť v hrudníku, bližšie neurčená (diferenciálna dg.: nemožno vylúčiť NSTEMI, nestabilnú angínu pectoris), I10 Primárna [esenciálna] artériová hypertenzia.",
    );
  });

  it("excludes low-confidence codes", () => {
    const out = formatZaverFromSuggestions([
      code("I21.4", "Akútny subendokardiálny infarkt myokardu"),
      code("Z99.99", "Synthetic dubious", "low"),
      code("I10", "Primárna [esenciálna] artériová hypertenzia"),
    ]);
    expect(out).not.toContain("Z99.99");
    expect(out).toContain("I21.4");
    expect(out).toContain("I10");
  });

  it("caps entries at max (default 10)", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      code(`I${(10 + i).toString().padStart(2, "0")}`, `Desc ${i}`),
    );
    const out = formatZaverFromSuggestions(many);
    // Count the "Desc N" occurrences; max 10.
    const matches = out.match(/Desc \d+/g) ?? [];
    expect(matches.length).toBe(10);
  });

  it("respects a custom max option", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      code(`I${(10 + i).toString().padStart(2, "0")}`, `Desc ${i}`),
    );
    const out = formatZaverFromSuggestions(many, { max: 5 });
    const matches = out.match(/Desc \d+/g) ?? [];
    expect(matches.length).toBe(5);
  });

  it("returns empty when every input is low-confidence", () => {
    const out = formatZaverFromSuggestions([
      code("I10", "hyp", "low"),
      code("K57", "div", "low"),
    ]);
    expect(out).toBe("");
  });

  it("does NOT double the trailing period", () => {
    // Agent might pass a description already ending in "."
    const out = formatZaverFromSuggestions([code("I10", "Hypertenzia.")]);
    expect(out).toBe("I10 Hypertenzia.");
    expect(out.match(/\.$/g)?.length).toBe(1);
  });
});
