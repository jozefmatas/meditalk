/**
 * Regression tests for the "Objective must contain labs if they
 * exist" contract. These guard against silent lab drops — where a
 * troponin or NT-proBNP fact is extracted but the labs section
 * renders empty.
 */

import { describe, it, expect } from "vitest";
import { renderLabsSection, renderEkgSection } from "./objective";
import { buildEncounterModel } from "../encounter-model";
import { emptyExtractedFacts, type ExtractedFact } from "../fact-extraction";

function fact(
  category: ExtractedFact["category"],
  value: string,
): ExtractedFact {
  return {
    category,
    value,
    source: { type: "transcript", sourceIndex: 0, evidence: value },
  };
}

describe("Objective labs — must not silently drop extracted lab facts", () => {
  it("renders a cardiology lab panel verbatim", () => {
    const facts = emptyExtractedFacts();
    facts.findings.push(
      fact("findings", "S-hscTnT 29,00 ng/l"),
      fact("findings", "NT-proBNP 801 ng/l"),
      fact("findings", "D-Dimer 0,28 μg/ml"),
      fact("findings", "Fibrinogén 4,54 g/l"),
      fact("findings", "Quick-INR 1,23"),
    );
    const model = buildEncounterModel({
      language: "sk",
      facts,
      candidateIcdCodes: [],
    });
    const rendered = renderLabsSection(model);
    expect(rendered).toContain("S-hscTnT");
    expect(rendered).toContain("NT-proBNP");
    expect(rendered).toContain("D-Dimer");
    expect(rendered).toContain("Fibrinogén");
    expect(rendered).toContain("Quick-INR");
  });

  it("preserves glucose (mmol/l) alongside other labs", () => {
    const facts = emptyExtractedFacts();
    facts.measurements.push(fact("measurements", "Glykémia 11,1 mmol/l"));
    facts.findings.push(fact("findings", "S-hscTnT 29,00 ng/l"));
    const model = buildEncounterModel({
      language: "sk",
      facts,
      candidateIcdCodes: [],
    });
    const rendered = renderLabsSection(model);
    expect(rendered).toContain("Glykémia");
    expect(rendered).toContain("S-hscTnT");
  });
});

describe("Objective EKG — full cardiology EKG line must survive", () => {
  it("renders an AF + intervals + ST-segment line verbatim", () => {
    const facts = emptyExtractedFacts();
    facts.findings.push(
      fact(
        "findings",
        "EKG: AF 110/min, VP, PZ V3-4, QRS 111 ms, QTc 441 ms, rS I, aVL, rSr' V1-2, ST segm. bez signif. denivel., T konkord.",
      ),
    );
    const model = buildEncounterModel({
      language: "sk",
      facts,
      candidateIcdCodes: [],
    });
    const rendered = renderEkgSection(model);
    expect(rendered).toContain("AF 110/min");
    expect(rendered).toContain("QRS 111 ms");
    expect(rendered).toContain("QTc 441 ms");
    expect(rendered).toContain("ST segm.");
  });
});
