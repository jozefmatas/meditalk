import { describe, it, expect } from "vitest";
import {
  TEMPLATES,
  getTemplateById,
  getDefaultTemplate,
  flattenTemplateSections,
} from "./index";
import type { Template } from "./types";

describe("TEMPLATES", () => {
  it("contains at least one template", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(1);
  });

  it("each template has required fields", () => {
    for (const t of TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.nameKey).toBeTruthy();
      expect(t.descriptionKey).toBeTruthy();
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

describe("flattenTemplateSections", () => {
  const testTemplate: Template = {
    id: "test",
    nameKey: "test",
    descriptionKey: "test",
    sections: [
      { id: "top1", labelKey: "top1" },
      {
        id: "top2",
        labelKey: "top2",
        subsections: [
          { id: "sub1", labelKey: "sub1" },
          { id: "sub2", labelKey: "sub2" },
        ],
      },
      { id: "top3", labelKey: "top3" },
    ],
  };

  it("returns flat sections with correct levels", () => {
    const flat = flattenTemplateSections(testTemplate);
    expect(flat).toEqual([
      { id: "top1", labelKey: "top1", level: 2 },
      { id: "top2", labelKey: "top2", level: 2 },
      { id: "sub1", labelKey: "sub1", level: 3, parentId: "top2" },
      { id: "sub2", labelKey: "sub2", level: 3, parentId: "top2" },
      { id: "top3", labelKey: "top3", level: 2 },
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
      // Every section should have an id and labelKey
      for (const s of flat) {
        expect(s.id).toBeTruthy();
        expect(s.labelKey).toBeTruthy();
      }
    }
  });
});
