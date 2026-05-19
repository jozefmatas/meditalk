// @vitest-environment node
import { describe, it, expect } from "vitest";
import { KIND_POLICY, resolveKind } from "./kind-policy";
import { formatConclusionContent } from "./pipeline";
import type { TemplateSection } from "../templates/types";

function mkSection(partial: Partial<TemplateSection>): TemplateSection {
  return {
    id: partial.id ?? "s_x",
    labels: partial.labels ?? { sk: "Unnamed" },
    ...(partial.kind ? { kind: partial.kind } : {}),
  };
}

describe("KIND_POLICY — behaviour matrix", () => {
  it("conclusion → renderModel sonnet (unused — conclusion is deterministic)", () => {
    expect(KIND_POLICY.conclusion.renderModel).toBe("sonnet");
  });

  it("vital-numeric → digit-grounded + voice examples suppressed + Haiku render", () => {
    expect(KIND_POLICY["vital-numeric"].digitGrounding).toBe(true);
    expect(KIND_POLICY["vital-numeric"].skipVoiceExamples).toBe(true);
    expect(KIND_POLICY["vital-numeric"].renderModel).toBe("haiku");
  });

  it("exam-narrative → Sonnet render + voice examples suppressed, no digit guard", () => {
    expect(KIND_POLICY["exam-narrative"].skipVoiceExamples).toBe(true);
    expect(KIND_POLICY["exam-narrative"].digitGrounding).toBe(false);
    expect(KIND_POLICY["exam-narrative"].renderModel).toBe("sonnet");
  });

  it("all kinds → Haiku critic", () => {
    expect(KIND_POLICY.default.criticModel).toBe("haiku");
    expect(KIND_POLICY["history-narrative"].criticModel).toBe("haiku");
    expect(KIND_POLICY["medication-list"].criticModel).toBe("haiku");
    expect(KIND_POLICY["vital-numeric"].criticModel).toBe("haiku");
    expect(KIND_POLICY["exam-narrative"].criticModel).toBe("haiku");
    expect(KIND_POLICY.conclusion.criticModel).toBe("haiku");
  });

  it("narrative kinds → Sonnet render", () => {
    expect(KIND_POLICY["history-narrative"].renderModel).toBe("sonnet");
    expect(KIND_POLICY["exam-narrative"].renderModel).toBe("sonnet");
    expect(KIND_POLICY.conclusion.renderModel).toBe("sonnet");
  });

  it("structural/default kinds → Haiku render", () => {
    expect(KIND_POLICY.default.renderModel).toBe("haiku");
    expect(KIND_POLICY["medication-list"].renderModel).toBe("haiku");
    expect(KIND_POLICY["vital-numeric"].renderModel).toBe("haiku");
  });

  it("default → neither voice-example skip nor digit grounding", () => {
    expect(KIND_POLICY.default.skipVoiceExamples).toBe(false);
    expect(KIND_POLICY.default.digitGrounding).toBe(false);
  });
});

describe("resolveKind — declarative field wins", () => {
  it("returns the explicit `kind` when set", () => {
    const s = mkSection({
      kind: "vital-numeric",
      labels: { sk: "Randomly-labeled section" },
    });
    expect(resolveKind(s)).toBe("vital-numeric");
  });
});

describe("resolveKind — legacy label fallback", () => {
  it("classifies TK / Pulz / Výška as vital-numeric", () => {
    expect(resolveKind(mkSection({ labels: { sk: "Krvný tlak" } }))).toBe(
      "vital-numeric",
    );
    expect(resolveKind(mkSection({ labels: { sk: "Pulz" } }))).toBe(
      "vital-numeric",
    );
    expect(resolveKind(mkSection({ labels: { sk: "Výška" } }))).toBe(
      "vital-numeric",
    );
    expect(resolveKind(mkSection({ labels: { sk: "BMI" } }))).toBe(
      "vital-numeric",
    );
    expect(resolveKind(mkSection({ labels: { sk: "EKG" } }))).toBe(
      "vital-numeric",
    );
  });

  it("classifies Záver / Assessment as conclusion", () => {
    expect(resolveKind(mkSection({ labels: { sk: "Záver" } }))).toBe(
      "conclusion",
    );
    expect(resolveKind(mkSection({ labels: { en: "Assessment" } }))).toBe(
      "conclusion",
    );
  });

  it("classifies LA / Lieková anamnéza as medication-list", () => {
    expect(resolveKind(mkSection({ labels: { sk: "LA" } }))).toBe(
      "medication-list",
    );
    expect(resolveKind(mkSection({ labels: { sk: "Lieková anamnéza" } }))).toBe(
      "medication-list",
    );
  });

  it("classifies Celkové / Fyzikálne vyšetrenie as exam-narrative", () => {
    expect(
      resolveKind(mkSection({ labels: { sk: "Celkové vyšetrenie" } })),
    ).toBe("exam-narrative");
    expect(
      resolveKind(mkSection({ labels: { sk: "Fyzikálne vyšetrenie" } })),
    ).toBe("exam-narrative");
  });

  it("unrecognised labels → default", () => {
    expect(
      resolveKind(mkSection({ labels: { sk: "Some Unmapped Section" } })),
    ).toBe("default");
  });

  it("diacritic-folding + case-insensitive matching on labels", () => {
    // "ZÁVER" variant capitalization + "Zaver" without diacritics both
    // normalise to the same "zaver" key.
    expect(resolveKind(mkSection({ labels: { sk: "ZÁVER" } }))).toBe(
      "conclusion",
    );
    expect(resolveKind(mkSection({ labels: { cs: "Zaver" } }))).toBe(
      "conclusion",
    );
  });
});

describe("formatConclusionContent — deterministic ICD formatter", () => {
  it("returns empty string when no codes", () => {
    expect(formatConclusionContent([])).toBe("");
  });

  it("excludes low-confidence codes", () => {
    const codes = [
      {
        code: "I21.1",
        description: "Akútny transmurálny infarkt myokardu na iných miestach",
        confidence: "high" as const,
        differential: undefined,
      },
      {
        code: "Z87.8",
        description: "Iné bližšie určené choroby v osobnej anamnéze",
        confidence: "low" as const,
        differential: undefined,
      },
    ];
    expect(formatConclusionContent(codes)).toBe(
      "Akútny transmurálny infarkt myokardu na iných miestach",
    );
  });

  it("joins high/medium descriptions with <br> (not newlines)", () => {
    const codes = [
      {
        code: "I21.1",
        description: "Akútny transmurálny infarkt myokardu na iných miestach",
        confidence: "high" as const,
        differential: undefined,
      },
      {
        code: "I10",
        description: "Primárna [esenciálna] artériová hypertenzia",
        confidence: "medium" as const,
        differential: undefined,
      },
      {
        code: "E11.9",
        description: "Diabetes mellitus 2. typu bez komplikácií",
        confidence: "medium" as const,
        differential: undefined,
      },
    ];
    expect(formatConclusionContent(codes)).toBe(
      "Akútny transmurálny infarkt myokardu na iných miestach<br>" +
        "Primárna [esenciálna] artériová hypertenzia<br>" +
        "Diabetes mellitus 2. typu bez komplikácií",
    );
  });

  it("returns empty when all codes are low confidence", () => {
    const codes = [
      {
        code: "Z87.8",
        description: "Iné bližšie určené choroby",
        confidence: "low" as const,
        differential: undefined,
      },
    ];
    expect(formatConclusionContent(codes)).toBe("");
  });

  it("does not include ICD code numbers in output", () => {
    const codes = [
      {
        code: "I21.1",
        description: "Akútny transmurálny infarkt",
        confidence: "high" as const,
        differential: undefined,
      },
    ];
    const result = formatConclusionContent(codes);
    expect(result).not.toContain("I21.1");
    expect(result).toBe("Akútny transmurálny infarkt");
  });
});
