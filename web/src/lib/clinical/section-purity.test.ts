import { describe, it, expect } from "vitest";
import { enforceSectionPurity } from "./section-purity";

describe("enforceSectionPurity — LA (medications) must not contain HPI narrative", () => {
  it("strips symptom narrative lines from LA", () => {
    const result = enforceSectionPurity(
      {
        s_la: [
          "Rytmonorm 1-0-1",
          "Pálenie nad srdiečkom vľavo od nedele na pondelok",
          "Eliquis 5 mg ráno a večer",
        ].join("\n"),
      },
      { s_la: "LA" },
    );
    expect(result.contents.s_la).toContain("Rytmonorm 1-0-1");
    expect(result.contents.s_la).toContain("Eliquis 5 mg");
    expect(result.contents.s_la).not.toContain("Pálenie");
    expect(
      result.violations.some(
        (v) => v.reason === "symptom_narrative_in_medications",
      ),
    ).toBe(true);
  });

  it("strips 'od nedele' / 'včera' phrases from LA", () => {
    const result = enforceSectionPurity(
      {
        s_la: [
          "Nolpaza 1-0-0",
          "Bolesť sa objavila včera (19.4.) dvakrát",
          "Betaloc ZOK 25 mg 1-0-0",
        ].join("\n"),
      },
      { s_la: "LA" },
    );
    expect(result.contents.s_la).toContain("Nolpaza");
    expect(result.contents.s_la).toContain("Betaloc ZOK 25 mg");
    expect(result.contents.s_la).not.toMatch(/bolest|vcera/i);
  });

  it("leaves a clean LA section untouched", () => {
    const result = enforceSectionPurity(
      { s_la: "Rytmonorm 1-0-1, Nolpaza 1-0-0, Eliquis 5 mg 1-0-1" },
      { s_la: "LA" },
    );
    expect(result.contents.s_la).toBe(
      "Rytmonorm 1-0-1, Nolpaza 1-0-0, Eliquis 5 mg 1-0-1",
    );
    expect(result.violations).toHaveLength(0);
  });
});

describe("enforceSectionPurity — EKG must not contain structured-assessment headings", () => {
  it("strips 'Hlavná diagnóza' / 'Vedľajšie diagnózy' from EKG", () => {
    const result = enforceSectionPurity(
      {
        s_ekg: [
          "EKG: frekvencia 56/min, PQ 0,28 s, QRS do 0,08 s",
          "Hlavná diagnóza",
          "I21.4 Akútny subendokardiálny infarkt myokardu",
          "Vedľajšie diagnózy",
          "I48 Fibrilácia predsiení a flutter predsiení",
        ].join("\n"),
      },
      { s_ekg: "EKG" },
    );
    expect(result.contents.s_ekg).toContain("EKG: frekvencia 56/min");
    expect(result.contents.s_ekg).not.toContain("Hlavná diagnóza");
    expect(result.contents.s_ekg).not.toContain("Vedľajšie diagnózy");
    expect(
      result.violations.some(
        (v) => v.reason === "icd_headings_outside_assessment",
      ),
    ).toBe(true);
  });
});

describe("enforceSectionPurity — Záver must not contain vitals lines", () => {
  it("strips raw vital lines from Záver", () => {
    const result = enforceSectionPurity(
      {
        s_zaver: [
          "Hlavná diagnóza",
          "I21.4 Akútny subendokardiálny infarkt myokardu",
          "TK 150/80 mmHg (14:02)",
          "SF 68/min",
          "Vedľajšie diagnózy",
          "I48 Fibrilácia predsiení",
        ].join("\n"),
      },
      { s_zaver: "Záver" },
    );
    expect(result.contents.s_zaver).toContain("I21.4");
    expect(result.contents.s_zaver).toContain("I48");
    expect(result.contents.s_zaver).not.toContain("TK 150/80");
    expect(result.contents.s_zaver).not.toContain("SF 68/min");
    expect(
      result.violations.some((v) => v.reason === "vitals_line_in_narrative"),
    ).toBe(true);
  });
});

describe("enforceSectionPurity — CSV debris detection", () => {
  it("strips lines containing raw CSV fragments like ',R07.4-'", () => {
    const result = enforceSectionPurity(
      {
        s_zaver: [
          "Hlavná diagnóza",
          "I21.4 Akútny subendokardiálny infarkt myokardu",
          'bližšie neurčená Bolesť v hrudníku, bližšie neurčená",R07.4-Bolesť v hrudníku',
          "R07.3 Iná bolesť v hrudníku",
        ].join("\n"),
      },
      { s_zaver: "Záver" },
    );
    expect(result.contents.s_zaver).toContain("I21.4");
    expect(result.contents.s_zaver).toContain("R07.3 Iná bolesť v hrudníku");
    // CSV debris line must be stripped
    expect(result.contents.s_zaver).not.toContain("R07.4-");
    expect(result.violations.some((v) => v.reason === "csv_debris")).toBe(true);
  });
});

describe("enforceSectionPurity — TO (chief complaint) must not contain ICD lines", () => {
  it("strips bare ICD-code lines from TO", () => {
    const result = enforceSectionPurity(
      {
        s_to: [
          "Od rána dňa 20.4.2026 tlaková bolesť na hrudi s vyžarovaním do ľavej ruky.",
          "I21.4 Akútny subendokardiálny infarkt myokardu",
        ].join("\n"),
      },
      { s_to: "TO" },
    );
    expect(result.contents.s_to).toContain("Od rána");
    expect(result.contents.s_to).not.toContain("I21.4");
    expect(
      result.violations.some(
        (v) => v.reason === "icd_codes_in_chief_complaint",
      ),
    ).toBe(true);
  });
});

describe("enforceSectionPurity — clean sections are untouched", () => {
  it("preserves a well-formed Záver verbatim", () => {
    const input = [
      "Hlavná diagnóza",
      "I21.4 Akútny subendokardiálny infarkt myokardu",
      "",
      "Vedľajšie diagnózy",
      "I48 Fibrilácia predsiení a flutter predsiení",
    ].join("\n");
    const result = enforceSectionPurity(
      { s_zaver: input },
      { s_zaver: "Záver" },
    );
    expect(result.contents.s_zaver).toBe(input);
    expect(result.violations).toHaveLength(0);
  });

  it("preserves a well-formed EKG verbatim", () => {
    const input = "EKG: frekvencia 56/min, PQ 0,28 s, ST v izočiare";
    const result = enforceSectionPurity({ s_ekg: input }, { s_ekg: "EKG" });
    expect(result.contents.s_ekg).toBe(input);
    expect(result.violations).toHaveLength(0);
  });
});
