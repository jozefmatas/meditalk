import { describe, it, expect } from "vitest";
import {
  sha256,
  stableStringify,
  computeFingerprint,
  diffFingerprints,
  type FingerprintInput,
} from "./fingerprint";
import { emptyExtractedFacts } from "./fact-extraction";
import type { ClinicalAnalysis } from "./types";

function baseInput(
  overrides: Partial<FingerprintInput> = {},
): FingerprintInput {
  return {
    templateId: "soap",
    language: "sk",
    transcriptChunks: ["Pacient má bolesti na hrudi."],
    doctorNotes: "",
    files: [],
    clinicalAnalysis: null,
    facts: emptyExtractedFacts(),
    systemPrompt: "You are a medical scribe.",
    userMessage: "Generate a SOAP note.",
    ...overrides,
  };
}

function makeClinicalAnalysis(
  overrides: Partial<ClinicalAnalysis> = {},
): ClinicalAnalysis {
  return {
    matchedConcepts: [],
    inferredSpecialty: "cardiology",
    problemClusters: [],
    candidateIcdCodes: [],
    mentionedMedications: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    ...overrides,
  };
}

describe("sha256", () => {
  it("produces a stable 64-char lowercase hex digest", () => {
    const hash = sha256("hello");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("is deterministic across repeated calls", () => {
    expect(sha256("meditalk")).toBe(sha256("meditalk"));
  });

  it("differs for different inputs", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("treats empty string as a valid input", () => {
    const empty = sha256("");
    expect(empty).toMatch(/^[0-9a-f]{64}$/);
    expect(empty).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("stableStringify", () => {
  it("sorts object keys alphabetically", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("produces the same output regardless of insertion order", () => {
    const a = stableStringify({ x: 1, y: 2, z: 3 });
    const b = stableStringify({ z: 3, y: 2, x: 1 });
    const c = stableStringify({ y: 2, x: 1, z: 3 });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("sorts keys recursively at every depth", () => {
    const a = stableStringify({ outer: { b: 1, a: 2 } });
    const b = stableStringify({ outer: { a: 2, b: 1 } });
    expect(a).toBe(b);
    expect(a).toBe('{"outer":{"a":2,"b":1}}');
  });

  it("preserves array order (arrays are semantically ordered)", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it("handles null, numbers, strings, booleans", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("hi")).toBe('"hi"');
    expect(stableStringify(true)).toBe("true");
  });

  it("handles nested arrays of objects", () => {
    const value = [
      { b: 1, a: 2 },
      { d: 4, c: 3 },
    ];
    expect(stableStringify(value)).toBe('[{"a":2,"b":1},{"c":3,"d":4}]');
  });
});

describe("computeFingerprint — stability", () => {
  it("produces identical composite hashes for identical input", () => {
    const a = computeFingerprint(baseInput());
    const b = computeFingerprint(baseInput());
    expect(a.composite).toBe(b.composite);
    expect(a.transcriptHash).toBe(b.transcriptHash);
    expect(a.systemPromptHash).toBe(b.systemPromptHash);
  });

  it("ignores `usage` token counts in clinical analysis", () => {
    const a = computeFingerprint(
      baseInput({
        clinicalAnalysis: makeClinicalAnalysis({
          usage: { inputTokens: 100, outputTokens: 200 },
        }),
      }),
    );
    const b = computeFingerprint(
      baseInput({
        clinicalAnalysis: makeClinicalAnalysis({
          usage: { inputTokens: 999, outputTokens: 42 },
        }),
      }),
    );
    // Token counts drift between runs — they must not affect the fingerprint.
    expect(a.clinicalAnalysisHash).toBe(b.clinicalAnalysisHash);
    expect(a.composite).toBe(b.composite);
  });

  it("ignores `usage` token counts in fact extraction", () => {
    const facts1 = emptyExtractedFacts();
    facts1.usage = { inputTokens: 10, outputTokens: 20 };
    const facts2 = emptyExtractedFacts();
    facts2.usage = { inputTokens: 500, outputTokens: 600 };

    const a = computeFingerprint(baseInput({ facts: facts1 }));
    const b = computeFingerprint(baseInput({ facts: facts2 }));

    expect(a.factsHash).toBe(b.factsHash);
    expect(a.composite).toBe(b.composite);
  });

  it("is insensitive to clinical analysis key order", () => {
    const ordered: ClinicalAnalysis = {
      matchedConcepts: [],
      inferredSpecialty: "cardiology",
      problemClusters: [],
      candidateIcdCodes: [],
      mentionedMedications: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    // Same object content but constructed in a different key order.
    const reordered: ClinicalAnalysis = {
      usage: { inputTokens: 0, outputTokens: 0 },
      mentionedMedications: [],
      candidateIcdCodes: [],
      problemClusters: [],
      inferredSpecialty: "cardiology",
      matchedConcepts: [],
    };

    const a = computeFingerprint(baseInput({ clinicalAnalysis: ordered }));
    const b = computeFingerprint(baseInput({ clinicalAnalysis: reordered }));
    expect(a.clinicalAnalysisHash).toBe(b.clinicalAnalysisHash);
  });

  it("normalizes doctor notes: undefined vs null vs empty vs whitespace", () => {
    const a = computeFingerprint(baseInput({ doctorNotes: undefined }));
    const b = computeFingerprint(baseInput({ doctorNotes: null }));
    const c = computeFingerprint(baseInput({ doctorNotes: "" }));
    const d = computeFingerprint(baseInput({ doctorNotes: "   " }));
    expect(a.doctorNotesHash).toBe(b.doctorNotesHash);
    expect(b.doctorNotesHash).toBe(c.doctorNotesHash);
    expect(c.doctorNotesHash).toBe(d.doctorNotesHash);
  });
});

describe("computeFingerprint — change detection", () => {
  it("transcript change flips transcriptHash, composite, and only those", () => {
    const a = computeFingerprint(baseInput());
    const b = computeFingerprint(
      baseInput({ transcriptChunks: ["Different transcript content."] }),
    );
    expect(a.transcriptHash).not.toBe(b.transcriptHash);
    expect(a.composite).not.toBe(b.composite);
    // Unrelated components stay the same
    expect(a.systemPromptHash).toBe(b.systemPromptHash);
    expect(a.userMessageHash).toBe(b.userMessageHash);
    expect(a.filesHash).toBe(b.filesHash);
  });

  it("chunk reorder changes the transcript hash", () => {
    const a = computeFingerprint(
      baseInput({ transcriptChunks: ["alpha", "beta"] }),
    );
    const b = computeFingerprint(
      baseInput({ transcriptChunks: ["beta", "alpha"] }),
    );
    // Order IS semantically meaningful — reordering = different transcript.
    expect(a.transcriptHash).not.toBe(b.transcriptHash);
  });

  it("file reorder changes the files hash", () => {
    const f1 = { name: "labs.pdf", type: "application/pdf", text: "WBC 12" };
    const f2 = { name: "xray.png", type: "image/png", text: "Fracture" };
    const a = computeFingerprint(baseInput({ files: [f1, f2] }));
    const b = computeFingerprint(baseInput({ files: [f2, f1] }));
    expect(a.filesHash).not.toBe(b.filesHash);
  });

  it("changing file text changes files hash but not other components", () => {
    const a = computeFingerprint(
      baseInput({
        files: [{ name: "labs.pdf", type: "application/pdf", text: "WBC 12" }],
      }),
    );
    const b = computeFingerprint(
      baseInput({
        files: [{ name: "labs.pdf", type: "application/pdf", text: "WBC 99" }],
      }),
    );
    expect(a.filesHash).not.toBe(b.filesHash);
    expect(a.composite).not.toBe(b.composite);
    expect(a.transcriptHash).toBe(b.transcriptHash);
    expect(a.systemPromptHash).toBe(b.systemPromptHash);
  });

  it("changing templateId changes composite even if all component hashes match", () => {
    const a = computeFingerprint(baseInput({ templateId: "soap" }));
    const b = computeFingerprint(baseInput({ templateId: "h&p" }));
    // Component hashes are the same — templateId is part of the composite.
    expect(a.systemPromptHash).toBe(b.systemPromptHash);
    expect(a.composite).not.toBe(b.composite);
  });

  it("changing language changes composite", () => {
    const a = computeFingerprint(baseInput({ language: "sk" }));
    const b = computeFingerprint(baseInput({ language: "en" }));
    expect(a.composite).not.toBe(b.composite);
  });

  it("changing system prompt isolates systemPromptHash change", () => {
    const a = computeFingerprint(baseInput());
    const b = computeFingerprint(
      baseInput({ systemPrompt: "Completely different prompt." }),
    );
    expect(a.systemPromptHash).not.toBe(b.systemPromptHash);
    expect(a.userMessageHash).toBe(b.userMessageHash);
    expect(a.transcriptHash).toBe(b.transcriptHash);
    expect(a.composite).not.toBe(b.composite);
  });

  it("changing clinical analysis content changes only the clinicalAnalysisHash", () => {
    const a = computeFingerprint(
      baseInput({
        clinicalAnalysis: makeClinicalAnalysis({
          inferredSpecialty: "cardiology",
        }),
      }),
    );
    const b = computeFingerprint(
      baseInput({
        clinicalAnalysis: makeClinicalAnalysis({
          inferredSpecialty: "neurology",
        }),
      }),
    );
    expect(a.clinicalAnalysisHash).not.toBe(b.clinicalAnalysisHash);
    expect(a.transcriptHash).toBe(b.transcriptHash);
    expect(a.systemPromptHash).toBe(b.systemPromptHash);
    expect(a.composite).not.toBe(b.composite);
  });

  it("changing facts changes factsHash", () => {
    const facts = emptyExtractedFacts();
    facts.symptoms.push({
      category: "symptoms",
      value: "chest pain",
      source: { type: "transcript", sourceIndex: 0, evidence: "chest pain" },
    });
    const a = computeFingerprint(baseInput());
    const b = computeFingerprint(baseInput({ facts }));
    expect(a.factsHash).not.toBe(b.factsHash);
    expect(a.composite).not.toBe(b.composite);
  });
});

describe("computeFingerprint — counts", () => {
  it("reports transcript, doctor notes, file, and fact counts", () => {
    const facts = emptyExtractedFacts();
    facts.symptoms.push({
      category: "symptoms",
      value: "headache",
      source: { type: "transcript", sourceIndex: 0, evidence: "headache" },
    });
    facts.diagnoses.push({
      category: "diagnoses",
      value: "migraine",
      source: { type: "transcript", sourceIndex: 0, evidence: "migraine" },
    });
    const fp = computeFingerprint(
      baseInput({
        transcriptChunks: ["abc", "de"], // length after join: 3 + len("\n---CHUNK---\n") + 2
        doctorNotes: "hello",
        files: [
          { name: "a.pdf", type: "application/pdf", text: "file content" },
        ],
        facts,
      }),
    );
    expect(fp.counts.doctorNotesChars).toBe(5);
    expect(fp.counts.fileCount).toBe(1);
    expect(fp.counts.filesTotalChars).toBe("file content".length);
    expect(fp.counts.factCount).toBe(2);
    expect(fp.counts.transcriptChars).toBeGreaterThan(0);
  });
});

describe("diffFingerprints", () => {
  it("reports equal=true for identical fingerprints", () => {
    const a = computeFingerprint(baseInput());
    const b = computeFingerprint(baseInput());
    const d = diffFingerprints(a, b);
    expect(d.equal).toBe(true);
    expect(d.changedComponents).toEqual([]);
  });

  it("pinpoints exactly the transcript as the changed component", () => {
    const a = computeFingerprint(baseInput());
    const b = computeFingerprint(
      baseInput({ transcriptChunks: ["different"] }),
    );
    const d = diffFingerprints(a, b);
    expect(d.equal).toBe(false);
    expect(d.changedComponents).toEqual(["transcriptHash"]);
  });

  it("reports multiple changed components at once", () => {
    const a = computeFingerprint(baseInput());
    const b = computeFingerprint(
      baseInput({
        transcriptChunks: ["different"],
        systemPrompt: "different",
      }),
    );
    const d = diffFingerprints(a, b);
    expect(d.equal).toBe(false);
    expect(d.changedComponents.sort()).toEqual(
      ["systemPromptHash", "transcriptHash"].sort(),
    );
  });

  it("reports templateId as the changed component when only templateId differs", () => {
    const a = computeFingerprint(baseInput({ templateId: "soap" }));
    const b = computeFingerprint(baseInput({ templateId: "h&p" }));
    const d = diffFingerprints(a, b);
    expect(d.equal).toBe(false);
    expect(d.changedComponents).toEqual(["templateId"]);
  });

  it("reports language as the changed component when only language differs", () => {
    const a = computeFingerprint(baseInput({ language: "sk" }));
    const b = computeFingerprint(baseInput({ language: "en" }));
    const d = diffFingerprints(a, b);
    expect(d.equal).toBe(false);
    expect(d.changedComponents).toEqual(["language"]);
  });
});
