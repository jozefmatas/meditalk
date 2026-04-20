import { describe, it, expect } from "vitest";
import { runSanityGate, stripPhiOnlyLines } from "./sanity-gate";
import type { ExtractedFact } from "./fact-extraction";

describe("stripPhiOnlyLines", () => {
  it("removes a line containing only [ADDRESS] and a timestamp", () => {
    const input = ["TK 150/80 mmHg (14:02)", "[ADDRESS] (14:02)"].join("\n");
    const { text, stripped } = stripPhiOnlyLines(input);
    expect(text).toBe("TK 150/80 mmHg (14:02)");
    expect(stripped).toHaveLength(1);
  });

  it("removes multiple PHI-only timestamped lines in a block", () => {
    const input = [
      "TK 150/80 mmHg (14:02)",
      "[ADDRESS] (14:02)",
      "[ADDRESS] (14:31)",
      "[ADDRESS] (14:58)",
      "SF 68/min (14:02)",
    ].join("\n");
    const { text, stripped } = stripPhiOnlyLines(input);
    expect(stripped).toHaveLength(3);
    expect(text).toContain("TK 150/80 mmHg");
    expect(text).toContain("SF 68/min");
    expect(text).not.toContain("[ADDRESS]");
  });

  it("keeps lines where PHI appears alongside clinical content", () => {
    const input = "Pacient [PATIENT_NAME], GCS 15, orientovaný.";
    const { text, stripped } = stripPhiOnlyLines(input);
    expect(text).toBe(input);
    expect(stripped).toHaveLength(0);
  });

  it("handles bullet-style PHI-only lines", () => {
    const input = ["- [PHONE]", "- Pacient pri vedomí"].join("\n");
    const { text, stripped } = stripPhiOnlyLines(input);
    expect(stripped).toHaveLength(1);
    expect(text).toContain("Pacient pri vedomí");
    expect(text).not.toContain("[PHONE]");
  });

  it("leaves lines unchanged when no PHI tokens are present", () => {
    const input = "TK 150/80 mmHg\nSF 68/min";
    const { text, stripped } = stripPhiOnlyLines(input);
    expect(text).toBe(input);
    expect(stripped).toHaveLength(0);
  });

  it("handles an empty input", () => {
    const { text, stripped } = stripPhiOnlyLines("");
    expect(text).toBe("");
    expect(stripped).toHaveLength(0);
  });
});

describe("runSanityGate — PHI-only stripping integration", () => {
  it("strips PHI-only lines and records them as interventions + info", () => {
    const result = runSanityGate({
      sectionContents: {
        vitals: [
          "TK 150/80 mmHg (14:02)",
          "[ADDRESS] (14:02)",
          "[ADDRESS] (14:31)",
        ].join("\n"),
      },
      sectionLabels: { vitals: "Krvný tlak" },
    });

    expect(result.contents.vitals).toContain("TK 150/80 mmHg");
    expect(result.contents.vitals).not.toContain("[ADDRESS]");

    const phiInterventions = result.report.interventions.filter(
      (i) => i.code === "strip_phi_only_line",
    );
    expect(phiInterventions).toHaveLength(2);
    expect(
      result.report.info.some((i) => i.code === "phi_only_line_stripped"),
    ).toBe(true);
  });
});

describe("runSanityGate — empty critical section detection + auto-rerender", () => {
  it("auto-rerenders Assessment from the ICD block when empty and ICD is available", () => {
    const diagnoses: ExtractedFact[] = [
      {
        category: "diagnoses",
        value: "STEMI",
        source: { type: "transcript", sourceIndex: 0, evidence: "STEMI" },
      },
    ];
    const result = runSanityGate({
      sectionContents: { assessment: "" },
      sectionLabels: { assessment: "Záver" },
      validatedFacts: { diagnoses, medications: [] },
      icdBlock: "- I21.2 Akútny transmurálny infarkt myokardu",
    });
    // Auto-fixed — contents should now have the ICD-rendered text
    expect(result.contents.assessment).toContain("I21.2");
    // Error downgraded to info, and an intervention recorded
    expect(
      result.report.errors.some(
        (e) => e.code === "empty_assessment_with_diagnoses",
      ),
    ).toBe(false);
    expect(
      result.report.info.some(
        (i) => i.code === "empty_assessment_with_diagnoses",
      ),
    ).toBe(true);
    expect(
      result.report.interventions.some(
        (i) =>
          i.code === "rerender_assessment_from_icd" &&
          i.autoRerendered === true,
      ),
    ).toBe(true);
  });

  it("still emits an error when Assessment is empty AND no ICD block is available", () => {
    const diagnoses: ExtractedFact[] = [
      {
        category: "diagnoses",
        value: "STEMI",
        source: { type: "transcript", sourceIndex: 0, evidence: "STEMI" },
      },
    ];
    const result = runSanityGate({
      sectionContents: { assessment: "" },
      sectionLabels: { assessment: "Záver" },
      validatedFacts: { diagnoses, medications: [] },
      // No icdBlock → auto-rerender cannot run.
    });
    expect(
      result.report.errors.some(
        (e) => e.code === "empty_assessment_with_diagnoses",
      ),
    ).toBe(true);
  });

  it("treats '—' as effectively empty and auto-rerenders when ICD is available", () => {
    const diagnoses: ExtractedFact[] = [
      {
        category: "diagnoses",
        value: "DM 2. typu",
        source: {
          type: "transcript",
          sourceIndex: 0,
          evidence: "DM 2. typu",
        },
      },
    ];
    const result = runSanityGate({
      sectionContents: { assessment: "—" },
      sectionLabels: { assessment: "Záver" },
      validatedFacts: { diagnoses, medications: [] },
      icdBlock: "- E11.9 Diabetes mellitus 2. typu bez komplikácií",
    });
    expect(result.contents.assessment).toContain("E11.9");
    expect(
      result.report.errors.some(
        (e) => e.code === "empty_assessment_with_diagnoses",
      ),
    ).toBe(false);
  });

  it("does NOT fire when no diagnosis facts exist", () => {
    const result = runSanityGate({
      sectionContents: { assessment: "" },
      sectionLabels: { assessment: "Záver" },
      validatedFacts: { diagnoses: [], medications: [] },
    });
    expect(
      result.report.errors.some(
        (e) => e.code === "empty_assessment_with_diagnoses",
      ),
    ).toBe(false);
  });

  it("does NOT fire when Assessment is populated", () => {
    const diagnoses: ExtractedFact[] = [
      {
        category: "diagnoses",
        value: "STEMI",
        source: { type: "transcript", sourceIndex: 0, evidence: "STEMI" },
      },
    ];
    const result = runSanityGate({
      sectionContents: { assessment: "I21.2 Akútny transmurálny infarkt" },
      sectionLabels: { assessment: "Záver" },
      validatedFacts: { diagnoses, medications: [] },
    });
    expect(
      result.report.errors.some(
        (e) => e.code === "empty_assessment_with_diagnoses",
      ),
    ).toBe(false);
  });
});

describe("runSanityGate — impossible measurement safety net (auto-strip)", () => {
  it("auto-strips impossible vital lines and keeps the rest", () => {
    const result = runSanityGate({
      sectionContents: {
        vitals: "TK 120/80 mmHg (14:02)\nTK 800/100 mmHg (14:31)",
      },
      sectionLabels: { vitals: "Krvný tlak" },
    });
    // Offending line removed, normal one kept
    expect(result.contents.vitals).toContain("TK 120/80 mmHg");
    expect(result.contents.vitals).not.toContain("800/100");
    // Warning + intervention recorded
    expect(
      result.report.warnings.some(
        (w) => w.code === "impossible_measurement_in_output",
      ),
    ).toBe(true);
    expect(
      result.report.interventions.some(
        (i) =>
          i.code === "strip_impossible_measurement" &&
          i.autoRerendered === true,
      ),
    ).toBe(true);
  });

  it("does not warn on normal vitals", () => {
    const result = runSanityGate({
      sectionContents: { vitals: "TK 120/80 mmHg (14:02)" },
      sectionLabels: { vitals: "Krvný tlak" },
    });
    expect(
      result.report.warnings.some(
        (w) => w.code === "impossible_measurement_in_output",
      ),
    ).toBe(false);
  });
});

describe("runSanityGate — misrouted content reporting", () => {
  it("reports a warning when Pass C strips medication lines from OA", () => {
    // OA contains an obvious medication block — enforceContentRouting
    // should strip it, and the gate should report the strip.
    const sectionContents = {
      oa: [
        "Chronická medikácia:",
        "Amlodipin 5 mg 1-0-0",
        "Bisoprolol 2,5 mg 1-0-0",
        "Atorvastatin 20 mg 0-0-1",
      ].join("\n"),
    };
    const result = runSanityGate({
      sectionContents,
      sectionLabels: { oa: "OA" },
    });
    expect(
      result.report.warnings.some(
        (w) => w.code === "misrouted_content_stripped",
      ),
    ).toBe(true);
    expect(
      result.report.interventions.some(
        (i) => i.code === "strip_misrouted_content",
      ),
    ).toBe(true);
  });
});

describe("runSanityGate — contract", () => {
  it("never throws on empty input and returns an empty report", () => {
    const result = runSanityGate({
      sectionContents: {},
      sectionLabels: {},
    });
    expect(result.contents).toEqual({});
    expect(result.report.errors).toEqual([]);
    expect(result.report.warnings).toEqual([]);
    expect(result.report.info).toEqual([]);
    expect(result.report.interventions).toEqual([]);
  });

  it("preserves section IDs that weren't modified", () => {
    const result = runSanityGate({
      sectionContents: {
        la: "Amlodipin 5 mg 1-0-0",
        to: "Bolesť na hrudi od rána.",
      },
      sectionLabels: { la: "LA", to: "TO" },
    });
    expect(result.contents.la).toBe("Amlodipin 5 mg 1-0-0");
    expect(result.contents.to).toBe("Bolesť na hrudi od rána.");
  });
});
