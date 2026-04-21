// @vitest-environment node
import { describe, it, expect } from "vitest";
import { preprocessSource } from "./source-preprocessor";
import type { RawSource } from "./section-agent";

function run(source: RawSource) {
  return preprocessSource(source);
}

// ─── OCR medication blocks ────────────────────────────────────────────

describe("OCR medication block — one-per-line", () => {
  it("captures every line under a Medikácia heading", () => {
    const r = run({
      files: [
        {
          name: "discharge.md",
          text: `Medikácia:
Anopyrin 100 mg
Arixtra 2,5 mg sc à 24h
PRESTARIUM A 5 mg`,
        },
      ],
    });
    expect(r.annotations.medicationsFromOCR).toEqual([
      "Anopyrin 100 mg",
      "Arixtra 2,5 mg sc à 24h",
      "PRESTARIUM A 5 mg",
    ]);
  });

  it("captures Odporúčania blocks as well", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: `Odporúčania:
Arixtra 2,5 mg sc à 24h
Egilok 25 mg 1/2-0-1/2`,
        },
      ],
    });
    expect(r.annotations.medicationsFromOCR).toContain(
      "Arixtra 2,5 mg sc à 24h",
    );
    expect(r.annotations.medicationsFromOCR).toContain(
      "Egilok 25 mg 1/2-0-1/2",
    );
  });

  it("stops at a blank line", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: `Medikácia:
Anopyrin 100 mg

Diagnózy:
Hypertenzia`,
        },
      ],
    });
    expect(r.annotations.medicationsFromOCR).toEqual(["Anopyrin 100 mg"]);
  });

  it("stops at the next heading", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: `Medikácia:
Anopyrin 100 mg
Odporúčania:
Egilok 25 mg`,
        },
      ],
    });
    // Both blocks captured — Odporúčania is itself a med heading
    expect(r.annotations.medicationsFromOCR).toContain("Anopyrin 100 mg");
    expect(r.annotations.medicationsFromOCR).toContain("Egilok 25 mg");
  });
});

describe("OCR medication block — inline comma-separated", () => {
  it("splits a single inline line by commas into entries", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: "Medikácia: Anopyrin 100 mg, Atoris 80 mg, PRESTARIUM A 5 mg, Trombex 75 mg",
        },
      ],
    });
    expect(r.annotations.medicationsFromOCR).toEqual([
      "Anopyrin 100 mg",
      "Atoris 80 mg",
      "PRESTARIUM A 5 mg",
      "Trombex 75 mg",
    ]);
  });

  it("handles bold markdown heading", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: `**Medikácia:**
Anopyrin 100 mg
Atoris 80 mg`,
        },
      ],
    });
    expect(r.annotations.medicationsFromOCR).toContain("Anopyrin 100 mg");
    expect(r.annotations.medicationsFromOCR).toContain("Atoris 80 mg");
  });
});

// ─── Carrier coverage (paste → doctorNotes / transcript flow) ────────

describe("OCR-style blocks are scanned in every source carrier", () => {
  it("extracts meds when the discharge letter is pasted into doctorNotes", () => {
    const r = run({
      doctorNotes: `# Lekárska prepúšťacia správa
Medikácia:
Anopyrin 100 mg
Arixtra 2,5 mg sc à 24h
PRESTARIUM A 5 mg`,
    });
    expect(r.annotations.medicationsFromOCR).toContain("Anopyrin 100 mg");
    expect(r.annotations.medicationsFromOCR).toContain("PRESTARIUM A 5 mg");
  });

  it("extracts vitals when the report is pasted into doctorNotes", () => {
    const r = run({
      doctorNotes: "Hmotnosť: 75 kg Výška: 164 cm BMI: 27,9",
    });
    const keys = r.annotations.vitals.map((v) => v.key);
    expect(keys).toContain("height");
    expect(keys).toContain("weight");
    expect(keys).toContain("bmi");
  });

  it("catches transcript brand mentions pasted into doctorNotes", () => {
    const r = run({
      doctorNotes:
        "Pacientka hovorí: Beriem Prestarium. Ortopéd mi pichá Suplasin raz za pol roka.",
    });
    const all = r.annotations.medicationsFromTranscript.join(" | ");
    expect(all).toMatch(/prestarium/i);
    expect(all).toMatch(/suplasin/i);
  });

  it("extracts meds + vitals when everything is pasted into transcript", () => {
    const r = run({
      transcript: `Dobrý deň. Pacient príšiel.
Hmotnosť: 75 kg Výška: 164 cm BMI: 27,9
EKG: ASP, RS, SF 70/min
Medikácia:
Anopyrin 100 mg
PRESTARIUM A 5 mg 1/2-0-1/2`,
    });
    // Meds from the pasted "Medikácia:" block:
    expect(r.annotations.medicationsFromOCR).toContain("Anopyrin 100 mg");
    expect(r.annotations.medicationsFromOCR).toContain(
      "PRESTARIUM A 5 mg 1/2-0-1/2",
    );
    // Vitals:
    const keys = r.annotations.vitals.map((v) => v.key);
    expect(keys).toContain("weight");
    expect(keys).toContain("hr"); // loose HR from EKG reading
    // EKG reading preserved:
    expect(r.annotations.ekgReadings[0]).toContain("ASP");
  });
});

// ─── OCR medication dedup ─────────────────────────────────────────────

describe("OCR medication dedup", () => {
  it("collapses two Arixtra entries to the one with freq info", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: `Medikácia:
Arixtra 2,5 mg/0,5 ml injekčný roztok, naplnená injekčná striekačka
Egilok 25 mg

Odporúčania:
Arixtra 2,5 mg sc à 24h (15:00)
Egilok 25 mg 1/2-0-1/2`,
        },
      ],
    });
    const arixtras = r.annotations.medicationsFromOCR.filter((m) =>
      /arixtra/i.test(m),
    );
    expect(arixtras).toHaveLength(1);
    expect(arixtras[0]).toContain("sc à 24h");

    const egiloks = r.annotations.medicationsFromOCR.filter((m) =>
      /egilok/i.test(m),
    );
    expect(egiloks).toHaveLength(1);
    expect(egiloks[0]).toContain("1/2-0-1/2");
  });

  it("keeps distinct brand names (Atoridor vs Atoris stay separate)", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: `Medikácia:
Atoridor 80 mg

Odporúčania:
Atoris 80 mg 1-0-0`,
        },
      ],
    });
    const bases = r.annotations.medicationsFromOCR.map((m) =>
      m.split(/\s+/)[0].toLowerCase(),
    );
    expect(bases).toContain("atoridor");
    expect(bases).toContain("atoris");
  });
});

// ─── Loose heart-rate extraction ──────────────────────────────────────

describe("Loose heart-rate extraction", () => {
  it("pulls SF 70/min out of an EKG reading line", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: "EKG: ASP, RS, SF 70/min, LPHB, polymorfné KES",
        },
      ],
    });
    const hr = r.annotations.vitals.find((v) => v.key === "hr");
    expect(hr?.value).toBe("70/min");
  });

  it("pulls frekvencia 56/min out of a multi-line EKG block", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: `EKG:
Sinusový rytmus, frekvencia 56/min
PQ 0,28 s`,
        },
      ],
    });
    const hr = r.annotations.vitals.find((v) => v.key === "hr");
    expect(hr?.value).toBe("56/min");
  });

  it("does NOT duplicate when HR is already in a labelled vital line", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: "HR: 70/min\nEKG: SF 70/min, sinus",
        },
      ],
    });
    const hrs = r.annotations.vitals.filter((v) => v.key === "hr");
    expect(hrs).toHaveLength(1);
  });
});

// ─── Vital signs ──────────────────────────────────────────────────────

describe("Vital signs — line-anchored", () => {
  it("extracts height, weight, BMI from labelled lines", () => {
    const r = run({
      files: [
        {
          name: "echo.md",
          text: `Hmotnosť: 75 kg
Výška: 164 cm
BMI: 27,9`,
        },
      ],
    });
    expect(r.annotations.vitals).toEqual(
      expect.arrayContaining([
        { key: "weight", value: "75 kg" },
        { key: "height", value: "164 cm" },
        { key: "bmi", value: "27,9" },
      ]),
    );
  });

  it("recognises HR, SF, SpO2, TT labels", () => {
    const r = run({
      files: [
        {
          name: "obs.md",
          text: `HR: 70/min
SpO2: 97 %
TT: 36,8 °C`,
        },
      ],
    });
    const keys = r.annotations.vitals.map((v) => v.key);
    expect(keys).toContain("hr");
    expect(keys).toContain("spo2");
    expect(keys).toContain("temp");
  });

  it("ignores unrecognised labels", () => {
    const r = run({
      files: [{ name: "x.md", text: "Foo: 42 units\nBar: 7" }],
    });
    expect(r.annotations.vitals).toHaveLength(0);
  });
});

describe("Vital signs — inline (all on one line)", () => {
  it("splits an inline vitals line into separate entries", () => {
    const r = run({
      files: [
        {
          name: "echo.md",
          text: "16.04.2026 10:22 Hmotnosť: 75 kg Výška: 164 cm BMI: 27,9",
        },
      ],
    });
    const keys = r.annotations.vitals.map((v) => v.key);
    expect(keys).toContain("weight");
    expect(keys).toContain("height");
    expect(keys).toContain("bmi");
    // BMI must stop at 27,9 — not swallow the next label.
    const bmi = r.annotations.vitals.find((v) => v.key === "bmi");
    expect(bmi?.value).toBe("27,9");
  });

  it("deduplicates same key+value if it appears twice", () => {
    const r = run({
      files: [
        {
          name: "x.md",
          text: "Hmotnosť: 75 kg\nHmotnosť: 75 kg",
        },
      ],
    });
    const weights = r.annotations.vitals.filter((v) => v.key === "weight");
    expect(weights).toHaveLength(1);
  });
});

// ─── EKG blocks ───────────────────────────────────────────────────────

describe("EKG block", () => {
  it("captures an EKG reading on the same line as the heading", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: "EKG: ASP, RS, SF 70/min, LPHB, polymorfné KES, bigeminická väzba",
        },
      ],
    });
    expect(r.annotations.ekgReadings).toHaveLength(1);
    expect(r.annotations.ekgReadings[0]).toContain("ASP");
    expect(r.annotations.ekgReadings[0]).toContain("70/min");
  });

  it("captures a multi-line EKG reading after the heading", () => {
    const r = run({
      files: [
        {
          name: "d.md",
          text: `EKG:
Sínusový rytmus, frekvencia 56/min
PQ 0,28 s, QRS do 0,08 s
ST v izočiare, T negat. V1-V3`,
        },
      ],
    });
    expect(r.annotations.ekgReadings).toHaveLength(1);
    expect(r.annotations.ekgReadings[0]).toContain("PQ 0,28");
    expect(r.annotations.ekgReadings[0]).toContain("V1-V3");
  });
});

// ─── Transcript brand-name scan ───────────────────────────────────────

describe("transcript medication detection", () => {
  it("detects a single brand in a sentence", () => {
    const r = run({
      transcript: "Pacient berie Rytmonorm 1-0-1.",
    });
    expect(r.annotations.medicationsFromTranscript).toEqual([
      "Rytmonorm 1-0-1",
    ]);
  });

  it("detects multiple brands across multiple sentences", () => {
    const r = run({
      transcript:
        "Beriem Rytmonorm 1-0-1. Mám Eliquis 5 mg ráno a večer. Tunol podľa potreby.",
    });
    const mentioned = r.annotations.medicationsFromTranscript.join(" | ");
    expect(mentioned).toContain("Rytmonorm 1-0-1");
    expect(mentioned).toContain("Eliquis 5 mg ráno a večer");
    expect(mentioned).toContain("Tunol podľa potreby");
  });

  it("keeps the same sentence's dose/freq attached to the brand", () => {
    const r = run({
      transcript: "Eliquis 5 mg ráno a večer. Potom aj Nolpaza 1-0-0.",
    });
    expect(
      r.annotations.medicationsFromTranscript.find((m) => /eliquis/i.test(m)),
    ).toContain("5 mg");
    expect(
      r.annotations.medicationsFromTranscript.find((m) => /nolpaza/i.test(m)),
    ).toContain("1-0-0");
  });

  it("ignores non-whitelisted brand-like words", () => {
    const r = run({
      transcript: "Pacient berie Zqxwvbrt 1-0-1.",
    });
    expect(r.annotations.medicationsFromTranscript).toHaveLength(0);
  });

  it("deduplicates repeated mentions", () => {
    const r = run({
      transcript: "Beriem PRESTARIUM. Beriem PRESTARIUM.",
    });
    expect(
      r.annotations.medicationsFromTranscript.filter((m) =>
        /prestarium/i.test(m),
      ),
    ).toHaveLength(1);
  });
});

// ─── Annotation output ────────────────────────────────────────────────

describe("annotated output", () => {
  it("appends <STRUCTURED_FACTS> to the transcript when facts exist", () => {
    const r = run({
      transcript: "Pacientka hovorí: dýcha sa jej dobre.",
      files: [{ name: "x.md", text: "Výška: 164 cm\nHmotnosť: 75 kg" }],
    });
    expect(r.source.transcript).toContain("dýcha sa jej dobre");
    expect(r.source.transcript).toContain("<STRUCTURED_FACTS>");
    expect(r.source.transcript).toContain(
      '<VITAL key="height" value="164 cm"/>',
    );
    expect(r.source.transcript).toContain(
      '<VITAL key="weight" value="75 kg"/>',
    );
  });

  it("does NOT append a block when nothing was found", () => {
    const r = run({
      transcript: "Pacientka dnes dobre spí.",
    });
    expect(r.source.transcript).toBe("Pacientka dnes dobre spí.");
    expect(r.source.transcript).not.toContain("<STRUCTURED_FACTS>");
  });

  it("escapes XML special characters in the annotation", () => {
    const r = run({
      files: [{ name: "d.md", text: "EKG: <note> with & inside" }],
    });
    expect(r.source.transcript ?? "").toContain("&lt;note&gt;");
    expect(r.source.transcript ?? "").toContain("&amp;");
  });

  it("returns bare annotation when no transcript is provided", () => {
    const r = run({
      files: [{ name: "d.md", text: "Výška: 164 cm" }],
    });
    expect(r.source.transcript).toBeDefined();
    expect(r.source.transcript?.startsWith("<STRUCTURED_FACTS>")).toBe(true);
  });
});

// ─── End-to-end Morgovská-style fixture ───────────────────────────────

describe("end-to-end Morgovská fixture", () => {
  it("captures 6 OCR meds + 3 vitals + 1 EKG + 1-2 transcript meds", () => {
    const r = run({
      transcript:
        "Pacientka. Beriem PRESTARIUM. Ortopéd mi pichá Suplasin raz za pol roka.",
      files: [
        {
          name: "discharge.md",
          text: `EKG: ASP, RS, SF 70/min, LPHB, polymorfné KES, bigeminická väzba

Hmotnosť: 75 kg Výška: 164 cm BMI: 27,9

**Medikácia:**
Anopyrin 100 mg, Arixtra 2,5 mg sc à 24h, Atoridor 80 mg, Egilok 25 mg, PRESTARIUM A 5 mg, Trombex 75 mg
`,
        },
      ],
    });

    expect(r.annotations.medicationsFromOCR).toHaveLength(6);
    expect(r.annotations.medicationsFromOCR).toContain("Anopyrin 100 mg");
    expect(r.annotations.medicationsFromOCR).toContain("PRESTARIUM A 5 mg");
    expect(r.annotations.medicationsFromOCR).toContain("Trombex 75 mg");

    // 4 vitals: weight + height + BMI from the vitals line, plus HR
    // pulled out of the EKG reading ("SF 70/min").
    expect(r.annotations.vitals).toHaveLength(4);
    expect(r.annotations.vitals.find((v) => v.key === "height")?.value).toBe(
      "164 cm",
    );
    expect(r.annotations.vitals.find((v) => v.key === "weight")?.value).toBe(
      "75 kg",
    );
    expect(r.annotations.vitals.find((v) => v.key === "bmi")?.value).toBe(
      "27,9",
    );
    expect(r.annotations.vitals.find((v) => v.key === "hr")?.value).toBe(
      "70/min",
    );

    expect(r.annotations.ekgReadings).toHaveLength(1);
    expect(r.annotations.ekgReadings[0]).toContain("ASP");

    expect(
      r.annotations.medicationsFromTranscript.some((m) => /suplasin/i.test(m)),
    ).toBe(true);
  });
});
