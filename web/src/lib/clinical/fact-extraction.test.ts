import { describe, it, expect } from "vitest";
import {
  buildFactExtractionSystemPrompt,
  buildFactExtractionUserMessage,
  emptyExtractedFacts,
  coerceFact,
  FACT_CATEGORIES,
} from "./fact-extraction";
import type { FactExtractionInput } from "./fact-extraction";

describe("emptyExtractedFacts", () => {
  it("returns an object with every category as an empty array", () => {
    const f = emptyExtractedFacts();
    for (const cat of FACT_CATEGORIES) {
      expect(f[cat]).toEqual([]);
    }
    expect(f.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("FACT_CATEGORIES", () => {
  it("contains the 15 documented categories", () => {
    expect(FACT_CATEGORIES).toEqual([
      "demographics",
      "chiefComplaint",
      "symptoms",
      "findings",
      "measurements",
      "diagnoses",
      "medications",
      "procedures",
      "familyHistory",
      "personalHistory",
      "socialHistory",
      "workHistory",
      "substanceUse",
      "epidemiologicalHistory",
      "plan",
    ]);
  });
});

describe("buildFactExtractionSystemPrompt", () => {
  it("mentions the target language label", () => {
    expect(buildFactExtractionSystemPrompt("sk")).toContain("Slovak");
    expect(buildFactExtractionSystemPrompt("cs")).toContain("Czech");
    expect(buildFactExtractionSystemPrompt("en")).toContain("English");
  });

  it("enforces the no-inference / evidence-required rules", () => {
    const prompt = buildFactExtractionSystemPrompt("sk");
    expect(prompt).toContain("EXPLICITLY stated");
    expect(prompt).toMatch(/VERBATIM evidence quote/i);
    expect(prompt).toMatch(/Missing is better than hallucinated/i);
  });

  it("forbids severity upgrades (ACS → STEMI)", () => {
    const prompt = buildFactExtractionSystemPrompt("sk");
    expect(prompt).toMatch(/ACS/i);
    expect(prompt).toMatch(/STEMI/i);
    expect(prompt).toMatch(/upgrade severity/i);
  });

  it("lists the 15 categories as valid JSON keys", () => {
    const prompt = buildFactExtractionSystemPrompt("en");
    for (const cat of FACT_CATEGORIES) {
      expect(prompt).toContain(cat);
    }
  });

  it("documents the sourceIndex schema", () => {
    const prompt = buildFactExtractionSystemPrompt("en");
    expect(prompt).toContain("sourceIndex");
    expect(prompt).toContain("transcript");
    expect(prompt).toContain("doctor_notes");
    expect(prompt).toContain("file");
  });

  it("enforces NO ASSUMPTION MODE for missing units", () => {
    const prompt = buildFactExtractionSystemPrompt("sk");
    expect(prompt).toContain("NO ASSUMPTION MODE");
    // Must cite the smoking example that motivated the rule
    expect(prompt).toContain("fajčí 15");
    // Must forbid defaulting to the most common interpretation
    expect(prompt).toMatch(/most common interpretation/i);
    // Must include the Slovak ambiguity marker for sk locale
    expect(prompt).toContain("(jednotka nešpecifikovaná)");
  });

  it("includes the Czech ambiguity marker for cs locale", () => {
    const prompt = buildFactExtractionSystemPrompt("cs");
    expect(prompt).toContain("(jednotka neuvedena)");
  });

  it("includes the English ambiguity marker for en locale", () => {
    const prompt = buildFactExtractionSystemPrompt("en");
    expect(prompt).toContain("(unit not specified)");
  });

  it("extends NO ASSUMPTION MODE to every missing clinical dimension", () => {
    const prompt = buildFactExtractionSystemPrompt("en");
    // Must cover dimensions beyond units
    expect(prompt).toMatch(/frequency/i);
    expect(prompt).toMatch(/duration/i);
    expect(prompt).toMatch(/laterality/i);
  });
});

describe("buildFactExtractionUserMessage", () => {
  it("numbers transcript chunks with sourceIndex=i", () => {
    const input: FactExtractionInput = {
      chunks: ["first chunk", "second chunk"],
    };
    const msg = buildFactExtractionUserMessage(input);
    expect(msg).toContain("[transcript sourceIndex=0]");
    expect(msg).toContain("first chunk");
    expect(msg).toContain("[transcript sourceIndex=1]");
    expect(msg).toContain("second chunk");
  });

  it("numbers files with sourceIndex and includes name+type", () => {
    const input: FactExtractionInput = {
      chunks: [],
      files: [{ name: "lab.pdf", type: "application/pdf", text: "Hb 14.2" }],
    };
    const msg = buildFactExtractionUserMessage(input);
    expect(msg).toContain(
      '[file sourceIndex=0 name="lab.pdf" type="application/pdf"]',
    );
    expect(msg).toContain("Hb 14.2");
  });

  it("marks doctor notes with sourceIndex=0", () => {
    const input: FactExtractionInput = {
      chunks: [],
      doctorNotes: "patient reports cough",
    };
    const msg = buildFactExtractionUserMessage(input);
    expect(msg).toContain("[doctor_notes sourceIndex=0]");
    expect(msg).toContain("patient reports cough");
  });

  it("omits empty sections", () => {
    const msg = buildFactExtractionUserMessage({ chunks: ["x"] });
    expect(msg).not.toContain("UPLOADED FILE CONTENTS");
    expect(msg).not.toContain("doctor_notes");
  });

  it("includes ENCOUNTER DATE when visitDate is provided", () => {
    const input: FactExtractionInput = {
      chunks: ["patient presents with cough"],
      visitDate: "2025-04-14T10:00:00Z",
    };
    const msg = buildFactExtractionUserMessage(input);
    expect(msg).toContain("ENCOUNTER DATE: 14.4.2025");
    expect(msg).toContain("dnes");
  });

  it("omits ENCOUNTER DATE when visitDate is undefined", () => {
    const input: FactExtractionInput = {
      chunks: ["patient presents with cough"],
    };
    const msg = buildFactExtractionUserMessage(input);
    expect(msg).not.toContain("ENCOUNTER DATE");
  });

  it("omits ENCOUNTER DATE when visitDate is invalid", () => {
    const input: FactExtractionInput = {
      chunks: ["patient presents with cough"],
      visitDate: "not-a-date",
    };
    const msg = buildFactExtractionUserMessage(input);
    expect(msg).not.toContain("ENCOUNTER DATE");
  });
});

describe("coerceFact", () => {
  it("returns null for non-objects", () => {
    expect(coerceFact(null, "symptoms")).toBeNull();
    expect(coerceFact("string", "symptoms")).toBeNull();
    expect(coerceFact(42, "symptoms")).toBeNull();
  });

  it("returns null when value is empty or missing", () => {
    expect(
      coerceFact(
        {
          value: "",
          source: { type: "transcript", sourceIndex: 0, evidence: "x" },
        },
        "symptoms",
      ),
    ).toBeNull();
    expect(
      coerceFact(
        {
          source: { type: "transcript", sourceIndex: 0, evidence: "x" },
        },
        "symptoms",
      ),
    ).toBeNull();
  });

  it("returns null when source is missing or malformed", () => {
    expect(coerceFact({ value: "cough" }, "symptoms")).toBeNull();
    expect(
      coerceFact(
        {
          value: "cough",
          source: { type: "wrong", sourceIndex: 0, evidence: "x" },
        },
        "symptoms",
      ),
    ).toBeNull();
  });

  it("returns null for negative or non-numeric sourceIndex", () => {
    expect(
      coerceFact(
        {
          value: "cough",
          source: { type: "transcript", sourceIndex: -1, evidence: "x" },
        },
        "symptoms",
      ),
    ).toBeNull();
    expect(
      coerceFact(
        {
          value: "cough",
          source: { type: "transcript", sourceIndex: "abc", evidence: "x" },
        },
        "symptoms",
      ),
    ).toBeNull();
  });

  it("coerces string sourceIndex to number", () => {
    const fact = coerceFact(
      {
        value: "cough",
        source: { type: "transcript", sourceIndex: "2", evidence: "coughs" },
      },
      "symptoms",
    );
    expect(fact).not.toBeNull();
    expect(fact!.source.sourceIndex).toBe(2);
  });

  it("returns null when evidence is missing or empty", () => {
    expect(
      coerceFact(
        {
          value: "cough",
          source: { type: "transcript", sourceIndex: 0, evidence: "" },
        },
        "symptoms",
      ),
    ).toBeNull();
    expect(
      coerceFact(
        {
          value: "cough",
          source: { type: "transcript", sourceIndex: 0 },
        },
        "symptoms",
      ),
    ).toBeNull();
  });

  it("overrides category with the expected category (trusts the container key)", () => {
    const fact = coerceFact(
      {
        category: "wrong",
        value: "cough",
        source: {
          type: "transcript",
          sourceIndex: 0,
          evidence: "patient coughs",
        },
      },
      "symptoms",
    );
    expect(fact).not.toBeNull();
    expect(fact!.category).toBe("symptoms");
  });

  it("trims whitespace on value and evidence", () => {
    const fact = coerceFact(
      {
        value: "  cough  ",
        source: {
          type: "transcript",
          sourceIndex: 0,
          evidence: "  patient coughs  ",
        },
      },
      "symptoms",
    );
    expect(fact!.value).toBe("cough");
    expect(fact!.source.evidence).toBe("patient coughs");
  });
});
