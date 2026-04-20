import { describe, it, expect } from "vitest";
import type { ExtractedFact } from "./fact-extraction";
import {
  classifySectionTiers,
  renderMedications,
  renderAssessment,
  buildHaikuSystemPrompt,
  buildHaikuUserMessage,
  buildOpusSystemPrompt,
  buildOpusUserMessage,
  collectUndistributedFindings,
  type SectionTier,
} from "./section-renderer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFact(
  category: ExtractedFact["category"],
  value: string,
): ExtractedFact {
  return {
    category,
    value,
    source: { type: "transcript", sourceIndex: 0, evidence: value },
  };
}

// ---------------------------------------------------------------------------
// Tier classification
// ---------------------------------------------------------------------------

describe("classifySectionTiers", () => {
  const labels: Record<string, string> = {
    s_to: "TO",
    s_oa: "OA",
    s_la: "LA",
    s_sa: "SA",
    s_ab: "Ab",
    s_ra: "RA",
    s_aa: "AA",
    s_ea: "EA",
    s_plan: "Plán",
    s_zaver: "Záver",
  };
  const contexts: Record<string, string> = {
    s_to: "Terajšie ochorenie (Chief complaint / present illness).",
    s_oa: "Osobná anamnéza (Past medical history).",
    s_la: "Lieková anamnéza (Current medications).",
    s_sa: "Sociálna anamnéza (Social history).",
    s_ab: "Abúzy (Substance use).",
    s_ra: "Rodinná anamnéza (Family history).",
    s_aa: "Alergická anamnéza (Allergies).",
    s_ea: "Epidemiologická anamnéza.",
    s_plan: "Plán liečby. Odporúčania.",
    s_zaver: "Záver / Assessment / Diagnózy.",
  };

  it("classifies LA as deterministic", () => {
    const tiers = classifySectionTiers(labels, contexts);
    const la = tiers.find((t) => t.id === "s_la");
    expect(la?.tier).toBe("deterministic");
    expect(la?.role).toBe("medications");
  });

  it("classifies Assessment (Záver) as deterministic", () => {
    const tiers = classifySectionTiers(labels, contexts);
    const zaver = tiers.find((t) => t.id === "s_zaver");
    expect(zaver?.tier).toBe("deterministic");
    expect(zaver?.role).toBe("assessment");
  });

  it("classifies TO as opus", () => {
    const tiers = classifySectionTiers(labels, contexts);
    const to = tiers.find((t) => t.id === "s_to");
    expect(to?.tier).toBe("opus");
    expect(to?.role).toBe("chiefComplaint");
  });

  it("classifies Plan as opus", () => {
    const tiers = classifySectionTiers(labels, contexts);
    const plan = tiers.find((t) => t.id === "s_plan");
    expect(plan?.tier).toBe("opus");
    expect(plan?.role).toBe("plan");
  });

  it("classifies OA, RA, SA, Ab, AA, EA as haiku", () => {
    const tiers = classifySectionTiers(labels, contexts);
    const haikuIds = ["s_oa", "s_ra", "s_sa", "s_ab", "s_aa", "s_ea"];
    for (const id of haikuIds) {
      const t = tiers.find((tier) => tier.id === id);
      expect(t?.tier).toBe("haiku");
    }
  });

  it("classifies exam subsection with 'vyšetrenie' context as haiku (findings)", () => {
    const tiers = classifySectionTiers(
      { s_cardio: "Kardiovaskulárne vyšetrenie" },
      { s_cardio: "Objektívny nález — kardiovaskulárne vyšetrenie." },
    );
    const cardio = tiers.find((t) => t.id === "s_cardio");
    expect(cardio?.tier).toBe("haiku");
    expect(cardio?.role).toBe("findings");
  });

  it("classifies unknown section as haiku (other)", () => {
    const tiers = classifySectionTiers(
      { s_misc: "Rôzne" },
      { s_misc: "Doplnkové informácie." },
    );
    const misc = tiers.find((t) => t.id === "s_misc");
    expect(misc?.tier).toBe("haiku");
    expect(misc?.role).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// Deterministic renderers
// ---------------------------------------------------------------------------

describe("renderMedications", () => {
  it("joins medication facts with comma separator", () => {
    const facts = [
      makeFact("medications", "Bisoprolol 5 mg 1-0-0"),
      makeFact("medications", "Ramipril 10 mg 1-0-0"),
      makeFact("medications", "Atorvastatin 20 mg 0-0-1"),
    ];
    const result = renderMedications(facts);
    expect(result).toBe(
      "Bisoprolol 5 mg 1-0-0, Ramipril 10 mg 1-0-0, Atorvastatin 20 mg 0-0-1",
    );
  });

  it("returns empty string for no facts", () => {
    expect(renderMedications([])).toBe("");
  });

  it("handles single fact", () => {
    const facts = [makeFact("medications", "Eliquis 5 mg 1-0-1")];
    expect(renderMedications(facts)).toBe("Eliquis 5 mg 1-0-1");
  });
});

describe("renderAssessment", () => {
  it("returns ICD block with stripped bullet prefix", () => {
    const block = "- I10 Esenciálna hypertenzia\n- E11.9 DM 2. typu bez komplikácií";
    const result = renderAssessment(block);
    expect(result).toBe(
      "I10 Esenciálna hypertenzia\nE11.9 DM 2. typu bez komplikácií",
    );
  });

  it("returns empty string when no ICD block", () => {
    expect(renderAssessment()).toBe("");
    expect(renderAssessment("")).toBe("");
  });

  it("preserves lines without bullet prefix", () => {
    const block = "I10 Esenciálna hypertenzia\nI21.0 Akútny STEMI";
    expect(renderAssessment(block)).toBe(block);
  });
});

// ---------------------------------------------------------------------------
// Haiku prompt builders
// ---------------------------------------------------------------------------

describe("buildHaikuSystemPrompt", () => {
  it("contains language name", () => {
    const prompt = buildHaikuSystemPrompt("sk");
    expect(prompt).toContain("Slovak");
  });

  it("contains no-bullets rule", () => {
    const prompt = buildHaikuSystemPrompt("en");
    expect(prompt).toContain("NO BULLET POINTS");
  });

  it("requests JSON output", () => {
    const prompt = buildHaikuSystemPrompt("cs");
    expect(prompt).toContain("valid JSON");
  });
});

describe("buildHaikuUserMessage", () => {
  const sections: SectionTier[] = [
    { id: "s_oa", label: "OA", role: "personalHistory", tier: "haiku" },
    { id: "s_ra", label: "RA", role: "other", tier: "haiku" },
  ];

  it("includes section labels and IDs", () => {
    const msg = buildHaikuUserMessage(sections, {}, {}, [], []);
    expect(msg).toContain('"OA" (s_oa)');
    expect(msg).toContain('"RA" (s_ra)');
  });

  it("includes assigned facts", () => {
    const facts: Record<string, ExtractedFact[]> = {
      s_oa: [makeFact("personalHistory", "Hypertenzia od roku 2010")],
    };
    const msg = buildHaikuUserMessage(sections, facts, {}, [], []);
    expect(msg).toContain("Hypertenzia od roku 2010");
  });

  it("includes context when provided", () => {
    const ctxs: Record<string, string> = {
      s_oa: "Past medical history section.",
    };
    const msg = buildHaikuUserMessage(sections, {}, ctxs, [], []);
    expect(msg).toContain("Context: Past medical history section.");
  });

  it("includes undistributed findings block", () => {
    const undistributed = [
      makeFact("findings", "Srdcové ozvy ohraničené, pravidelné"),
    ];
    const msg = buildHaikuUserMessage(sections, {}, {}, undistributed, []);
    expect(msg).toContain("UNDISTRIBUTED FINDINGS");
    expect(msg).toContain("Srdcové ozvy ohraničené, pravidelné");
  });

  it("includes unassigned facts as general context", () => {
    const unassigned = [makeFact("demographics", "72-ročný muž")];
    const msg = buildHaikuUserMessage(sections, {}, {}, [], unassigned);
    expect(msg).toContain("GENERAL CONTEXT");
    expect(msg).toContain("72-ročný muž");
  });

  it("shows (no facts assigned) for empty sections", () => {
    const msg = buildHaikuUserMessage(sections, {}, {}, [], []);
    expect(msg).toContain("(no facts assigned)");
  });
});

// ---------------------------------------------------------------------------
// Opus prompt builders
// ---------------------------------------------------------------------------

describe("buildOpusSystemPrompt", () => {
  it("contains language name", () => {
    const prompt = buildOpusSystemPrompt("sk");
    expect(prompt).toContain("Slovak");
  });

  it("contains no-bullets rule", () => {
    const prompt = buildOpusSystemPrompt("en");
    expect(prompt).toContain("NO BULLET POINTS");
  });

  it("instructs not to list medications", () => {
    const prompt = buildOpusSystemPrompt("sk");
    expect(prompt).toContain("Do NOT list medications");
  });

  it("includes style guide when provided", () => {
    const prompt = buildOpusSystemPrompt("sk", undefined, undefined, "Use formal tone.");
    expect(prompt).toContain("STYLE GUIDE");
    expect(prompt).toContain("Use formal tone.");
  });
});

describe("buildOpusUserMessage", () => {
  const sections: SectionTier[] = [
    { id: "s_to", label: "TO", role: "chiefComplaint", tier: "opus" },
    { id: "s_plan", label: "Plán", role: "plan", tier: "opus" },
  ];

  it("includes section labels and IDs", () => {
    const msg = buildOpusUserMessage(sections, {}, {});
    expect(msg).toContain('"TO" (s_to)');
    expect(msg).toContain('"Plán" (s_plan)');
  });

  it("includes assigned facts", () => {
    const facts: Record<string, ExtractedFact[]> = {
      s_to: [makeFact("chiefComplaint", "Bolesti na hrudníku od rána")],
    };
    const msg = buildOpusUserMessage(sections, facts, {});
    expect(msg).toContain("Bolesti na hrudníku od rána");
  });

  it("includes encounter date", () => {
    const msg = buildOpusUserMessage(sections, {}, {}, {
      visitDate: "2025-04-20",
    });
    expect(msg).toContain("ENCOUNTER DATE: 2025-04-20");
  });

  it("includes medication context as reference", () => {
    const msg = buildOpusUserMessage(sections, {}, {}, {
      medicationContext: "Bisoprolol 5 mg 1-0-0, Ramipril 10 mg 1-0-0",
    });
    expect(msg).toContain("MEDICATION CONTEXT");
    expect(msg).toContain("do NOT list these");
    expect(msg).toContain("Bisoprolol 5 mg");
  });

  it("includes diagnosis context as reference", () => {
    const msg = buildOpusUserMessage(sections, {}, {}, {
      diagnosisContext: "I10 Esenciálna hypertenzia",
    });
    expect(msg).toContain("DIAGNOSIS CONTEXT");
    expect(msg).toContain("do NOT list these");
    expect(msg).toContain("I10 Esenciálna hypertenzia");
  });

  it("includes doctor notes", () => {
    const msg = buildOpusUserMessage(sections, {}, {}, {
      doctorNotes: "Pacient prichádza pre bolesti na hrudníku.",
    });
    expect(msg).toContain("DOCTOR'S ADDITIONAL NOTES");
    expect(msg).toContain("Pacient prichádza pre bolesti na hrudníku.");
  });

  it("includes file texts", () => {
    const msg = buildOpusUserMessage(sections, {}, {}, {
      fileTexts: [
        { name: "report.pdf", type: "pdf", text: "Lab results: CRP 45 mg/l" },
      ],
    });
    expect(msg).toContain("UPLOADED FILE CONTENTS");
    expect(msg).toContain("report.pdf");
    expect(msg).toContain("CRP 45 mg/l");
  });
});

// ---------------------------------------------------------------------------
// Findings redistribution
// ---------------------------------------------------------------------------

describe("collectUndistributedFindings", () => {
  const parentIds = new Set(["s_obj"]);

  it("extracts findings and measurements from parent sections", () => {
    const assignment: Record<string, ExtractedFact[]> = {
      s_obj: [
        makeFact("findings", "Srdcové ozvy ohraničené"),
        makeFact("measurements", "TK 150/95 mmHg"),
        makeFact("personalHistory", "Hypertenzia od roku 2010"),
      ],
      s_cardio: [makeFact("findings", "Systolický šelest 2/6")],
    };

    const result = collectUndistributedFindings(assignment, parentIds);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe("Srdcové ozvy ohraničené");
    expect(result[1].value).toBe("TK 150/95 mmHg");
  });

  it("does NOT include non-findings facts from parent sections", () => {
    const assignment: Record<string, ExtractedFact[]> = {
      s_obj: [makeFact("personalHistory", "Hypertenzia od roku 2010")],
    };

    const result = collectUndistributedFindings(assignment, parentIds);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when no parent sections have facts", () => {
    const assignment: Record<string, ExtractedFact[]> = {
      s_cardio: [makeFact("findings", "Systolický šelest 2/6")],
    };

    const result = collectUndistributedFindings(assignment, parentIds);
    expect(result).toHaveLength(0);
  });

  it("handles empty parent set", () => {
    const assignment: Record<string, ExtractedFact[]> = {
      s_obj: [makeFact("findings", "Srdcové ozvy ohraničené")],
    };

    const result = collectUndistributedFindings(assignment, new Set());
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("classifies all sections even when contexts are missing", () => {
    const labels: Record<string, string> = {
      s_la: "LA",
      s_oa: "OA",
      s_plan: "Plán",
    };
    const tiers = classifySectionTiers(labels);
    expect(tiers).toHaveLength(3);
    expect(tiers.find((t) => t.id === "s_la")?.tier).toBe("deterministic");
    expect(tiers.find((t) => t.id === "s_plan")?.tier).toBe("opus");
  });

  it("handles empty section labels", () => {
    const tiers = classifySectionTiers({});
    expect(tiers).toHaveLength(0);
  });
});
