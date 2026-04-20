import { describe, it, expect } from "vitest";
import {
  extractNarrativeEvidence,
  formatNarrativeEvidence,
} from "./narrative-evidence";
import type { ExtractedFact } from "./fact-extraction";

function transcriptFact(value: string, evidence: string): ExtractedFact {
  return {
    category: "chiefComplaint",
    value,
    source: { type: "transcript", sourceIndex: 0, evidence },
  };
}

describe("extractNarrativeEvidence", () => {
  it("returns an empty list when there are no facts", () => {
    const snippets = extractNarrativeEvidence([], { chunks: ["anything"] });
    expect(snippets).toEqual([]);
  });

  it("extracts a window of context around a verbatim evidence quote", () => {
    const transcript =
      "Good afternoon. The patient reports severe chest pain that started this morning around 9am and has been getting worse. He denies shortness of breath or nausea.";
    const fact = transcriptFact(
      "severe chest pain since 9am",
      "severe chest pain that started this morning around 9am",
    );

    const snippets = extractNarrativeEvidence([fact], {
      chunks: [transcript],
    });
    expect(snippets).toHaveLength(1);
    expect(snippets[0].type).toBe("transcript");
    expect(snippets[0].text).toContain("severe chest pain");
    expect(snippets[0].text).toContain("9am");
    expect(snippets[0].text.length).toBeLessThan(transcript.length);
  });

  it("merges overlapping windows from the same source", () => {
    // Two facts with adjacent evidence quotes — windows overlap.
    const transcript =
      "Patient describes crushing chest pain starting 2 hours ago. Pain radiates to the left arm. He is diaphoretic and pale.";
    const factA = transcriptFact("crushing chest pain", "crushing chest pain");
    const factB = transcriptFact(
      "radiation to left arm",
      "radiates to the left arm",
    );
    const snippets = extractNarrativeEvidence([factA, factB], {
      chunks: [transcript],
    });

    // Should produce a SINGLE merged snippet for the transcript.
    const transcriptSnippets = snippets.filter((s) => s.type === "transcript");
    expect(transcriptSnippets).toHaveLength(1);
    expect(transcriptSnippets[0].text).toContain("crushing chest pain");
    expect(transcriptSnippets[0].text).toContain("radiates");
  });

  it("groups snippets by source — transcript and doctor notes stay separate", () => {
    const transcript = "Patient reports chest pain since 13:00.";
    const doctorNotes = "Observed diaphoresis. Refused intubation.";
    const factA = transcriptFact(
      "chest pain since 13:00",
      "chest pain since 13:00",
    );
    const factB: ExtractedFact = {
      category: "plan",
      value: "refused intubation",
      source: {
        type: "doctor_notes",
        sourceIndex: 0,
        evidence: "Refused intubation",
      },
    };

    const snippets = extractNarrativeEvidence([factA, factB], {
      chunks: [transcript],
      doctorNotes,
    });

    const types = snippets.map((s) => s.type).sort();
    expect(types).toEqual(["doctor_notes", "transcript"]);
  });

  it("skips facts whose evidence cannot be located in the declared source", () => {
    const fact = transcriptFact(
      "headache",
      "source quote that doesn't exist anywhere in the text",
    );
    const snippets = extractNarrativeEvidence([fact], {
      chunks: ["entirely different transcript"],
    });
    expect(snippets).toEqual([]);
  });

  it("respects the total-character budget", () => {
    const longChunk = "x".repeat(500) + " chest pain " + "y".repeat(500);
    const fact = transcriptFact("chest pain", "chest pain");
    const snippets = extractNarrativeEvidence(
      [fact],
      { chunks: [longChunk] },
      { maxTotalChars: 50 },
    );
    expect(snippets[0].text.length).toBeLessThanOrEqual(50);
  });

  it("handles Slovak diacritics via normalized-substring fallback", () => {
    // Evidence typed without diacritics, source has them
    const transcript = "Pacient má bolesť na hrudníku už od rána.";
    const fact = transcriptFact(
      "bolesť na hrudi od rána",
      "bolest na hrudniku uz od rana",
    );
    const snippets = extractNarrativeEvidence([fact], {
      chunks: [transcript],
    });
    expect(snippets).toHaveLength(1);
    expect(snippets[0].text).toContain("bolesť");
  });

  it("preserves the file directive when the source is a file", () => {
    const file = {
      name: "referral.pdf",
      type: "pdf",
      text: "Referring physician notes: acute chest pain evaluated.",
      context: "Only use the diagnosis from this file.",
    };
    const fact: ExtractedFact = {
      category: "chiefComplaint",
      value: "acute chest pain",
      source: {
        type: "file",
        sourceIndex: 0,
        evidence: "acute chest pain evaluated",
      },
    };
    const snippets = extractNarrativeEvidence([fact], {
      chunks: [],
      files: [file],
    });
    expect(snippets).toHaveLength(1);
    expect(snippets[0].fileName).toBe("referral.pdf");
    expect(snippets[0].fileDirective).toBe(
      "Only use the diagnosis from this file.",
    );
  });
});

describe("formatNarrativeEvidence", () => {
  it("returns empty string for no snippets", () => {
    expect(formatNarrativeEvidence([])).toBe("");
  });

  it("labels snippets by source type and renders directives", () => {
    const text = formatNarrativeEvidence([
      {
        type: "transcript",
        sourceIndex: 0,
        offset: 0,
        text: "chest pain since morning",
      },
      {
        type: "file",
        sourceIndex: 0,
        fileName: "lab.pdf",
        fileDirective: "Use only the troponin value.",
        offset: 0,
        text: "Troponin I 2.5 ng/mL",
      },
      {
        type: "doctor_notes",
        sourceIndex: 0,
        offset: 0,
        text: "Patient refused intubation.",
      },
    ]);
    expect(text).toContain("NARRATIVE EVIDENCE");
    expect(text).toContain("[Transcript chunk 0]");
    expect(text).toContain('[File "lab.pdf"]');
    expect(text).toContain(
      "DOCTOR'S DIRECTIVE FOR THIS FILE: Use only the troponin value.",
    );
    expect(text).toContain("[Doctor's notes]");
  });
});
