// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CATEGORY_ROUTING, filterSourceForKind } from "./kind-policy";
import type { ClassifiedPassage, RawSource } from "./section-agent";

// ── Helper ─────────────────────────────────────────────────────────

function makeSource(classifiedPassages: ClassifiedPassage[]): RawSource {
  return {
    transcript: "Patient reports chest pain.",
    doctorNotes: "NSTEMI suspected.",
    files: [
      {
        name: "discharge-letter.txt",
        text: classifiedPassages.map((p) => p.text).join("\n\n"),
        classifiedPassages,
      },
    ],
  };
}

const MEDICATION = {
  text: "Ramipril 5 mg 1-0-1, Atoris 80 mg 0-0-1",
  category: "medication" as const,
};
const DIAGNOSIS = {
  text: "Non STE AKS (subakutny v.s.)",
  category: "diagnosis" as const,
};
const FINDING = {
  text: "EF 60%, dobrá systolická funkcia ĽK",
  category: "finding" as const,
};
const VITAL = {
  text: "Výška: 164 cm Hmotnosť: 75 kg BMI: 27,9",
  category: "vital" as const,
};
const HISTORY = {
  text: "st.p. AE, st.p. herniotómii",
  category: "history" as const,
};
const PROCEDURE = {
  text: "CT kontrastné 1x, selektívna koronarografia",
  category: "procedure" as const,
};
const GENERAL = {
  text: "Pacient: MORDAVSKÁ Eva Mgr.",
  category: "general" as const,
};

const ALL_PASSAGES: ClassifiedPassage[] = [
  MEDICATION,
  DIAGNOSIS,
  FINDING,
  VITAL,
  HISTORY,
  PROCEDURE,
  GENERAL,
];

// ── Tests ──────────────────────────────────────────────────────────

describe("CATEGORY_ROUTING", () => {
  it("medication-list sees medication + general", () => {
    const allowed = CATEGORY_ROUTING["medication-list"];
    expect(allowed.has("medication")).toBe(true);
    expect(allowed.has("general")).toBe(true);
    expect(allowed.has("diagnosis")).toBe(false);
    expect(allowed.has("finding")).toBe(false);
  });

  it("conclusion sees diagnosis + finding + general", () => {
    const allowed = CATEGORY_ROUTING.conclusion;
    expect(allowed.has("diagnosis")).toBe(true);
    expect(allowed.has("finding")).toBe(true);
    expect(allowed.has("general")).toBe(true);
    expect(allowed.has("medication")).toBe(false);
  });

  it("vital-numeric sees vital + general only", () => {
    const allowed = CATEGORY_ROUTING["vital-numeric"];
    expect(allowed.has("vital")).toBe(true);
    expect(allowed.has("general")).toBe(true);
    expect(allowed.has("medication")).toBe(false);
    expect(allowed.has("diagnosis")).toBe(false);
  });

  it("default sees all categories", () => {
    const allowed = CATEGORY_ROUTING.default;
    for (const cat of [
      "medication",
      "diagnosis",
      "finding",
      "procedure",
      "vital",
      "history",
      "general",
    ] as const) {
      expect(allowed.has(cat)).toBe(true);
    }
  });

  it("history-narrative sees history + finding + diagnosis + general", () => {
    const allowed = CATEGORY_ROUTING["history-narrative"];
    expect(allowed.has("history")).toBe(true);
    expect(allowed.has("finding")).toBe(true);
    expect(allowed.has("diagnosis")).toBe(true);
    expect(allowed.has("general")).toBe(true);
    expect(allowed.has("medication")).toBe(false);
    expect(allowed.has("procedure")).toBe(false);
  });
});

describe("filterSourceForKind", () => {
  it("returns source unchanged when no classifiedPassages", () => {
    const source: RawSource = {
      transcript: "test",
      files: [{ name: "file.txt", text: "full text" }],
    };
    const filtered = filterSourceForKind(source, "medication-list");
    expect(filtered).toBe(source); // Same reference — no copy.
  });

  it("medication-list keeps only medication + general passages", () => {
    const source = makeSource(ALL_PASSAGES);
    const filtered = filterSourceForKind(source, "medication-list");

    const fileText = filtered.files![0].text;
    expect(fileText).toContain(MEDICATION.text);
    expect(fileText).toContain(GENERAL.text);
    expect(fileText).not.toContain(DIAGNOSIS.text);
    expect(fileText).not.toContain(FINDING.text);
    expect(fileText).not.toContain(VITAL.text);
  });

  it("conclusion keeps diagnosis + finding + general", () => {
    const source = makeSource(ALL_PASSAGES);
    const filtered = filterSourceForKind(source, "conclusion");

    const fileText = filtered.files![0].text;
    expect(fileText).toContain(DIAGNOSIS.text);
    expect(fileText).toContain(FINDING.text);
    expect(fileText).toContain(GENERAL.text);
    expect(fileText).not.toContain(MEDICATION.text);
    expect(fileText).not.toContain(PROCEDURE.text);
  });

  it("default keeps everything (no filter)", () => {
    const source = makeSource(ALL_PASSAGES);
    const filtered = filterSourceForKind(source, "default");

    const fileText = filtered.files![0].text;
    for (const p of ALL_PASSAGES) {
      expect(fileText).toContain(p.text);
    }
  });

  it("preserves transcript and doctorNotes unfiltered", () => {
    const source = makeSource([MEDICATION]);
    const filtered = filterSourceForKind(source, "conclusion");

    // conclusion filters out medication, so file text is empty
    expect(filtered.files![0].text).toBe("");
    // But transcript and doctorNotes are always preserved
    expect(filtered.transcript).toBe(source.transcript);
    expect(filtered.doctorNotes).toBe(source.doctorNotes);
  });

  it("handles mixed files: one classified, one not", () => {
    const source: RawSource = {
      transcript: "test",
      files: [
        {
          name: "classified.txt",
          text: "Ramipril\n\nDiagnóza I10",
          classifiedPassages: [MEDICATION, DIAGNOSIS],
        },
        {
          name: "unclassified.txt",
          text: "Full unclassified document text",
        },
      ],
    };

    const filtered = filterSourceForKind(source, "medication-list");

    // Classified file: only medication
    expect(filtered.files![0].text).toContain(MEDICATION.text);
    expect(filtered.files![0].text).not.toContain(DIAGNOSIS.text);
    // Unclassified file: unchanged
    expect(filtered.files![1].text).toBe("Full unclassified document text");
  });

  it("joins kept passages with double-newline separator", () => {
    const source = makeSource([MEDICATION, GENERAL]);
    const filtered = filterSourceForKind(source, "medication-list");

    expect(filtered.files![0].text).toBe(
      `${MEDICATION.text}\n\n${GENERAL.text}`,
    );
  });

  it("exam-narrative excludes past-mode files (with classifiedPassages)", () => {
    const source: RawSource = {
      transcript: "TK 140/80, pulz 72/min",
      files: [
        {
          name: "echokg.pdf",
          text: FINDING.text + "\n\n" + VITAL.text,
          classifiedPassages: [FINDING, VITAL],
          context: "komplet echokg",
        },
        {
          name: "todays-lab.pdf",
          text: "CRP 5.2, Gluk 6.1",
          // No classifiedPassages — "Actual" mode file
        },
      ],
    };

    const filtered = filterSourceForKind(source, "exam-narrative");

    // Past-mode file (echokg.pdf) should be blanked out
    expect(filtered.files![0].text).toBe("");
    // Actual-mode file should pass through unchanged
    expect(filtered.files![1].text).toBe("CRP 5.2, Gluk 6.1");
    // Transcript always preserved
    expect(filtered.transcript).toBe("TK 140/80, pulz 72/min");
  });

  it("vital-numeric excludes past-mode files (with classifiedPassages)", () => {
    const source = makeSource([VITAL, GENERAL]);
    const filtered = filterSourceForKind(source, "vital-numeric");

    // Past-mode file should be blanked out for vital sections
    expect(filtered.files![0].text).toBe("");
  });

  it("history-narrative still includes past-mode files", () => {
    const source = makeSource(ALL_PASSAGES);
    const filtered = filterSourceForKind(source, "history-narrative");

    const fileText = filtered.files![0].text;
    // history-narrative should still see relevant categories from past files
    expect(fileText).toContain(HISTORY.text);
    expect(fileText).toContain(FINDING.text);
    expect(fileText).toContain(DIAGNOSIS.text);
  });

  it("exam-narrative excludes fallback files (context but empty classifiedPassages)", () => {
    // This happens when file-focus fallback triggers: all passages failed
    // validation, so full text is returned with classifiedPassages: [].
    // The file still has a context (directive) — it's still Past mode.
    const source: RawSource = {
      transcript: "TK 130/80, pulz 68/min",
      files: [
        {
          name: "dg-a-medikacia.pdf",
          text: "Výška 188cm, Hmotnosť 98kg, BMI 27.9\nDg: I48.1 Fibrilácia predsiení",
          context: "DG a medikaciu s davkovanim",
          classifiedPassages: [], // fallback — empty
        },
      ],
    };

    const filtered = filterSourceForKind(source, "exam-narrative");

    // Past-mode file should be blanked even with empty classifiedPassages
    expect(filtered.files![0].text).toBe("");
    // Transcript always preserved
    expect(filtered.transcript).toBe("TK 130/80, pulz 68/min");
  });
});
