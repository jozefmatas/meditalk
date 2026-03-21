import { describe, it, expect } from "vitest";
import {
  TEMPLATES,
  getTemplateById,
  getDefaultTemplate,
  flattenTemplateSections,
  generateSectionId,
  resolveSectionLabel,
  buildSectionLabelsFromTemplate,
  buildSectionContextsFromTemplate,
} from "./index";
import type { Template, TemplateSection } from "./types";

describe("TEMPLATES", () => {
  it("contains at least one template", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(1);
  });

  it("each template has required fields", () => {
    for (const t of TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name.sk).toBeTruthy();
      expect(t.description.sk).toBeTruthy();
      expect(Array.isArray(t.sections)).toBe(true);
      expect(t.sections.length).toBeGreaterThan(0);
    }
  });

  it("has unique template IDs", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getTemplateById", () => {
  it("returns template for valid id", () => {
    const first = TEMPLATES[0];
    const found = getTemplateById(first.id);
    expect(found).toBe(first);
  });

  it("returns undefined for unknown id", () => {
    expect(getTemplateById("nonexistent-template")).toBeUndefined();
  });
});

describe("getDefaultTemplate", () => {
  it("returns a valid template", () => {
    const def = getDefaultTemplate();
    expect(def.id).toBeTruthy();
    expect(def.sections.length).toBeGreaterThan(0);
  });

  it("returns a template that exists in TEMPLATES", () => {
    const def = getDefaultTemplate();
    expect(TEMPLATES).toContain(def);
  });
});

describe("generateSectionId", () => {
  it("generates ids with s_ prefix", () => {
    const id = generateSectionId();
    expect(id).toMatch(/^s_/);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSectionId()));
    expect(ids.size).toBe(100);
  });
});

describe("resolveSectionLabel", () => {
  const section: TemplateSection = {
    id: "s_test",
    labels: { sk: "Srdce", en: "Heart", cs: "Srdce" },
  };

  it("returns label for requested locale", () => {
    expect(resolveSectionLabel(section, "en")).toBe("Heart");
    expect(resolveSectionLabel(section, "sk")).toBe("Srdce");
  });

  it("falls back to sk when locale not found", () => {
    expect(resolveSectionLabel(section, "pl")).toBe("Srdce");
  });

  it("falls back to id when no labels match", () => {
    const bare: TemplateSection = { id: "s_bare", labels: {} };
    expect(resolveSectionLabel(bare, "en")).toBe("s_bare");
  });
});

describe("buildSectionLabelsFromTemplate", () => {
  const template: Template = {
    id: "test",
    name: { sk: "Test" },
    description: { sk: "Test" },
    sections: [
      { id: "s_a", labels: { sk: "Sekcia A", en: "Section A" } },
      {
        id: "s_b",
        labels: { sk: "Sekcia B", en: "Section B" },
        subsections: [
          { id: "s_c", labels: { sk: "Podsekcia C", en: "Subsection C" } },
        ],
      },
    ],
  };

  it("builds labels map for sk", () => {
    const labels = buildSectionLabelsFromTemplate(template, "sk");
    expect(labels).toEqual({
      s_a: "Sekcia A",
      s_b: "Sekcia B",
      s_c: "Podsekcia C",
    });
  });

  it("builds labels map for en", () => {
    const labels = buildSectionLabelsFromTemplate(template, "en");
    expect(labels).toEqual({
      s_a: "Section A",
      s_b: "Section B",
      s_c: "Subsection C",
    });
  });
});

describe("buildSectionContextsFromTemplate", () => {
  const template: Template = {
    id: "test",
    name: { sk: "Test" },
    description: { sk: "Test" },
    sections: [
      {
        id: "s_a",
        labels: { sk: "A" },
        context: "Include details about A",
      },
      { id: "s_b", labels: { sk: "B" } },
      {
        id: "s_c",
        labels: { sk: "C" },
        subsections: [
          {
            id: "s_d",
            labels: { sk: "D" },
            context: "D context info",
          },
        ],
      },
    ],
  };

  it("collects only sections with context", () => {
    const contexts = buildSectionContextsFromTemplate(template);
    expect(contexts).toEqual({
      s_a: "Include details about A",
      s_d: "D context info",
    });
  });
});

describe("flattenTemplateSections", () => {
  const testTemplate: Template = {
    id: "test",
    name: { sk: "Test" },
    description: { sk: "Test" },
    sections: [
      { id: "top1", labels: { sk: "Top 1" } },
      {
        id: "top2",
        labels: { sk: "Top 2" },
        subsections: [
          { id: "sub1", labels: { sk: "Sub 1" } },
          { id: "sub2", labels: { sk: "Sub 2" } },
        ],
      },
      { id: "top3", labels: { sk: "Top 3" } },
    ],
  };

  it("returns flat sections with correct levels", () => {
    const flat = flattenTemplateSections(testTemplate);
    expect(flat).toEqual([
      { id: "top1", labels: { sk: "Top 1" }, level: 2 },
      { id: "top2", labels: { sk: "Top 2" }, level: 2 },
      { id: "sub1", labels: { sk: "Sub 1" }, level: 3, parentId: "top2" },
      { id: "sub2", labels: { sk: "Sub 2" }, level: 3, parentId: "top2" },
      { id: "top3", labels: { sk: "Top 3" }, level: 2 },
    ]);
  });

  it("top-level sections have level 2", () => {
    const flat = flattenTemplateSections(testTemplate);
    const topLevel = flat.filter((s) => !s.parentId);
    for (const s of topLevel) {
      expect(s.level).toBe(2);
    }
  });

  it("subsections have level 3 and correct parentId", () => {
    const flat = flattenTemplateSections(testTemplate);
    const subs = flat.filter((s) => s.parentId);
    for (const s of subs) {
      expect(s.level).toBe(3);
      expect(s.parentId).toBe("top2");
    }
  });

  it("works with real templates", () => {
    for (const t of TEMPLATES) {
      const flat = flattenTemplateSections(t);
      expect(flat.length).toBeGreaterThan(0);
      // Every section should have an id and labels
      for (const s of flat) {
        expect(s.id).toBeTruthy();
        expect(s.labels).toBeTruthy();
        expect(typeof s.labels).toBe("object");
      }
    }
  });
});
