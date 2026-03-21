import { describe, it, expect } from "vitest";
import {
  DEFAULT_TEMPLATE_ID,
  flattenTemplateSections,
  generateSectionId,
  resolveSectionLabel,
  buildSectionLabelsFromTemplate,
  buildSectionContextsFromTemplate,
} from "./index";
import type { Template, TemplateSection } from "./types";

describe("DEFAULT_TEMPLATE_ID", () => {
  it("is a valid template ID string", () => {
    expect(DEFAULT_TEMPLATE_ID).toMatch(/^t_/);
    expect(DEFAULT_TEMPLATE_ID.length).toBeGreaterThan(3);
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
});
