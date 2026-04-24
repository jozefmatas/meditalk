// @vitest-environment node
import { describe, it, expect } from "vitest";
import { KIND_POLICY, resolveKind } from "./pipeline";
import type { TemplateSection } from "../templates/types";

function mkSection(partial: Partial<TemplateSection>): TemplateSection {
  return {
    id: partial.id ?? "s_x",
    labels: partial.labels ?? { sk: "Unnamed" },
    ...(partial.kind ? { kind: partial.kind } : {}),
  };
}

describe("KIND_POLICY — behaviour matrix", () => {
  it("conclusion → skips the main render loop", () => {
    expect(KIND_POLICY.conclusion.skipRenderInMainLoop).toBe(true);
  });

  it("vital-numeric → digit-grounded + voice examples suppressed", () => {
    expect(KIND_POLICY["vital-numeric"].digitGrounding).toBe(true);
    expect(KIND_POLICY["vital-numeric"].skipVoiceExamples).toBe(true);
  });

  it("exam-narrative → voice examples suppressed but no digit guard", () => {
    expect(KIND_POLICY["exam-narrative"].skipVoiceExamples).toBe(true);
    expect(KIND_POLICY["exam-narrative"].digitGrounding).toBe(false);
  });

  it("medication-list → Haiku critic (completeness over strictness)", () => {
    expect(KIND_POLICY["medication-list"].criticModel).toBe("haiku");
  });

  it("default + history-narrative + conclusion → Sonnet critic", () => {
    expect(KIND_POLICY.default.criticModel).toBe("sonnet");
    expect(KIND_POLICY["history-narrative"].criticModel).toBe("sonnet");
    expect(KIND_POLICY.conclusion.criticModel).toBe("sonnet");
  });

  it("default → neither voice-example skip nor digit grounding", () => {
    expect(KIND_POLICY.default.skipVoiceExamples).toBe(false);
    expect(KIND_POLICY.default.digitGrounding).toBe(false);
    expect(KIND_POLICY.default.skipRenderInMainLoop).toBe(false);
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
    expect(
      resolveKind(mkSection({ labels: { en: "Assessment" } })),
    ).toBe("conclusion");
  });

  it("classifies LA / Lieková anamnéza as medication-list", () => {
    expect(resolveKind(mkSection({ labels: { sk: "LA" } }))).toBe(
      "medication-list",
    );
    expect(
      resolveKind(mkSection({ labels: { sk: "Lieková anamnéza" } })),
    ).toBe("medication-list");
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
