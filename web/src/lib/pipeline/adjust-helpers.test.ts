// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  foldLabel,
  isVitalOrExamLabel,
  collectLeafSectionsForRouter,
  shouldRerunZaver,
  expandVitalGroup,
} from "./adjust-helpers";
import type { Template } from "@/lib/templates/types";

// ── Helper: minimal template builder ──────────────────────────────

function makeTemplate(
  sections: Array<{
    id: string;
    labels: Record<string, string>;
    context?: string;
    subsections?: Array<{
      id: string;
      labels: Record<string, string>;
      context?: string;
    }>;
  }>,
): Template {
  return {
    id: "test-template",
    name: { sk: "Test" },
    description: { sk: "Test template" },
    sections: sections.map((s) => ({
      ...s,
      subsections: s.subsections?.map((sub) => ({ ...sub })),
    })),
  };
}

// ── foldLabel ─────────────────────────────────────────────────────

describe("foldLabel", () => {
  it("strips diacritics and lowercases", () => {
    expect(foldLabel("Výška")).toBe("vyska");
    expect(foldLabel("Hmotnosť")).toBe("hmotnost");
    expect(foldLabel("Krvný tlak")).toBe("krvny tlak");
  });

  it("strips trailing colons and whitespace", () => {
    expect(foldLabel("Pulz:")).toBe("pulz");
    expect(foldLabel("EKG:  ")).toBe("ekg");
  });

  it("handles already-folded labels", () => {
    expect(foldLabel("bmi")).toBe("bmi");
  });
});

// ── isVitalOrExamLabel ────────────────────────────────────────────

describe("isVitalOrExamLabel", () => {
  it("matches Slovak vital labels with diacritics", () => {
    expect(isVitalOrExamLabel("Výška")).toBe(true);
    expect(isVitalOrExamLabel("Hmotnosť")).toBe(true);
    expect(isVitalOrExamLabel("Krvný tlak")).toBe(true);
    expect(isVitalOrExamLabel("Pulz")).toBe(true);
    expect(isVitalOrExamLabel("EKG")).toBe(true);
  });

  it("matches English vital labels", () => {
    expect(isVitalOrExamLabel("Blood Pressure")).toBe(true);
    expect(isVitalOrExamLabel("Heart Rate")).toBe(true);
    expect(isVitalOrExamLabel("Height")).toBe(true);
    expect(isVitalOrExamLabel("Weight")).toBe(true);
  });

  it("matches exam labels", () => {
    expect(isVitalOrExamLabel("Celkové vyšetrenie")).toBe(true);
    expect(isVitalOrExamLabel("Fyzikálne vyšetrenie")).toBe(true);
    expect(isVitalOrExamLabel("Physical Examination")).toBe(true);
  });

  it("rejects non-vital labels", () => {
    expect(isVitalOrExamLabel("Osobná anamnéza")).toBe(false);
    expect(isVitalOrExamLabel("Záver")).toBe(false);
    expect(isVitalOrExamLabel("Lieky")).toBe(false);
  });
});

// ── collectLeafSectionsForRouter ──────────────────────────────────

describe("collectLeafSectionsForRouter", () => {
  it("collects leaf sections (skips parents with subsections)", () => {
    const template = makeTemplate([
      {
        id: "parent",
        labels: { sk: "Parent" },
        subsections: [
          {
            id: "child1",
            labels: { sk: "Child 1" },
            context: "First child context\nline2",
          },
          { id: "child2", labels: { sk: "Child 2" } },
        ],
      },
      {
        id: "standalone",
        labels: { sk: "Standalone" },
        context: "Stand alone context",
      },
    ]);

    const sectionLabels: Record<string, string> = {
      child1: "Child 1",
      child2: "Child 2",
      standalone: "Standalone",
    };

    const result = collectLeafSectionsForRouter(template, sectionLabels);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(["child1", "child2", "standalone"]);
    // contractHint is first line of context, truncated to 160 chars
    expect(result[0].contractHint).toBe("First child context");
    expect(result[1].contractHint).toBe("");
    expect(result[2].contractHint).toBe("Stand alone context");
  });

  it("uses section id as fallback label", () => {
    const template = makeTemplate([
      { id: "unknown", labels: { sk: "Unknown" } },
    ]);
    const result = collectLeafSectionsForRouter(template, {});
    expect(result[0].label).toBe("unknown");
  });
});

// ── shouldRerunZaver ──────────────────────────────────────────────

describe("shouldRerunZaver", () => {
  const template = makeTemplate([
    { id: "oa", labels: { sk: "Osobná anamnéza" } },
    { id: "to", labels: { sk: "Terajšie ochorenie" } },
    { id: "la", labels: { sk: "Lieky" } },
    { id: "zaver", labels: { sk: "Záver" } },
  ]);
  const sectionLabels: Record<string, string> = {
    oa: "Osobná anamnéza",
    to: "Terajšie ochorenie",
    la: "Lieky",
    zaver: "Záver",
  };

  it("returns true when Záver itself is in affected set", () => {
    expect(
      shouldRerunZaver(
        { id: "zaver" },
        new Set(["zaver"]),
        template,
        sectionLabels,
      ),
    ).toBe(true);
  });

  it("returns true when OA is affected", () => {
    expect(
      shouldRerunZaver(
        { id: "zaver" },
        new Set(["oa"]),
        template,
        sectionLabels,
      ),
    ).toBe(true);
  });

  it("returns true when TO is affected", () => {
    expect(
      shouldRerunZaver(
        { id: "zaver" },
        new Set(["to"]),
        template,
        sectionLabels,
      ),
    ).toBe(true);
  });

  it("returns false when only non-diagnosis sections are affected", () => {
    expect(
      shouldRerunZaver(
        { id: "zaver" },
        new Set(["la"]),
        template,
        sectionLabels,
      ),
    ).toBe(false);
  });

  it("returns false when zaver is null", () => {
    expect(
      shouldRerunZaver(null, new Set(["oa"]), template, sectionLabels),
    ).toBe(false);
  });
});

// ── expandVitalGroup ──────────────────────────────────────────────

describe("expandVitalGroup", () => {
  const template = makeTemplate([
    { id: "oa", labels: { sk: "OA" } },
    { id: "tk", labels: { sk: "TK" } },
    { id: "pulz", labels: { sk: "Pulz" } },
    { id: "ekg", labels: { sk: "EKG" } },
  ]);
  const sectionLabels: Record<string, string> = {
    oa: "OA",
    tk: "TK",
    pulz: "Pulz",
    ekg: "EKG",
  };

  it("expands to all vital sections when one is affected", () => {
    const result = expandVitalGroup(new Set(["tk"]), template, sectionLabels);
    expect(result).toEqual(new Set(["tk", "pulz", "ekg"]));
  });

  it("does not expand when no vital section is affected", () => {
    const result = expandVitalGroup(new Set(["oa"]), template, sectionLabels);
    expect(result).toEqual(new Set(["oa"]));
  });

  it("preserves non-vital sections in the expanded set", () => {
    const result = expandVitalGroup(
      new Set(["oa", "pulz"]),
      template,
      sectionLabels,
    );
    expect(result).toEqual(new Set(["oa", "pulz", "tk", "ekg"]));
  });
});
