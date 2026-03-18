import { describe, it, expect } from "vitest";
import { buildTemplateHtml, flattenSectionIds } from "./html";
import type { Template } from "./types";

const simpleTemplate: Template = {
  id: "simple",
  nameKey: "simple",
  descriptionKey: "simple",
  sections: [
    { id: "subjective", labelKey: "subjective" },
    { id: "objective", labelKey: "objective" },
    { id: "plan", labelKey: "plan" },
  ],
};

const nestedTemplate: Template = {
  id: "nested",
  nameKey: "nested",
  descriptionKey: "nested",
  sections: [
    {
      id: "exam",
      labelKey: "exam",
      subsections: [
        { id: "vitals", labelKey: "vitals" },
        { id: "skin", labelKey: "skin" },
      ],
    },
    { id: "plan", labelKey: "plan" },
  ],
};

const labels: Record<string, string> = {
  subjective: "Subjective",
  objective: "Objective",
  plan: "Plan",
  exam: "Examination",
  vitals: "Vitals",
  skin: "Skin",
};

describe("buildTemplateHtml", () => {
  it("generates headings and content for all sections", () => {
    const contents = {
      subjective: "Patient has headache.",
      objective: "BP 120/80",
      plan: "Prescribe ibuprofen.",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain("<h2>Subjective</h2>");
    expect(html).toContain("<p>Patient has headache.</p>");
    expect(html).toContain("<h2>Objective</h2>");
    expect(html).toContain("<h2>Plan</h2>");
  });

  it("renders empty sections as heading-only when skipEmpty is false", () => {
    const contents = { subjective: "Has pain.", objective: "", plan: "" };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain("<h2>Objective</h2>");
    expect(html).toContain("<h2>Plan</h2>");
  });

  it("skips empty sections when skipEmpty is true", () => {
    const contents = { subjective: "Has pain.", objective: "", plan: "" };
    const html = buildTemplateHtml(simpleTemplate, contents, labels, {
      skipEmpty: true,
    });
    expect(html).toContain("<h2>Subjective</h2>");
    expect(html).not.toContain("<h2>Objective</h2>");
    expect(html).not.toContain("<h2>Plan</h2>");
  });

  it('skips "Not stated" content when skipEmpty is true', () => {
    const contents = {
      subjective: "Has pain.",
      objective: "Not stated",
      plan: "Neuvedené",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels, {
      skipEmpty: true,
    });
    expect(html).toContain("<h2>Subjective</h2>");
    expect(html).not.toContain("<h2>Objective</h2>");
    expect(html).not.toContain("<h2>Plan</h2>");
  });

  it("renders subsections with h3", () => {
    const contents = {
      exam: "",
      vitals: "BP 130/85",
      skin: "Normal",
      plan: "Follow up",
    };
    const html = buildTemplateHtml(nestedTemplate, contents, labels);
    expect(html).toContain("<h2>Examination</h2>");
    expect(html).toContain("<h3>Vitals</h3>");
    expect(html).toContain("<p>BP 130/85</p>");
    expect(html).toContain("<h3>Skin</h3>");
  });

  it("escapes HTML entities in content", () => {
    const contents = {
      subjective: 'Patient says <script>alert("xss")</script>',
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("converts newlines to <br> tags", () => {
    const contents = {
      subjective: "Line one\nLine two",
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain("Line one<br>Line two");
  });

  it("uses section id as fallback label", () => {
    const contents = { subjective: "Text" };
    const html = buildTemplateHtml(simpleTemplate, contents, {});
    expect(html).toContain("<h2>subjective</h2>");
  });
});

describe("flattenSectionIds", () => {
  it("flattens simple template", () => {
    expect(flattenSectionIds(simpleTemplate)).toEqual([
      "subjective",
      "objective",
      "plan",
    ]);
  });

  it("flattens nested template including subsection ids", () => {
    expect(flattenSectionIds(nestedTemplate)).toEqual([
      "exam",
      "vitals",
      "skin",
      "plan",
    ]);
  });

  it("returns empty array for template with no sections", () => {
    const empty: Template = {
      id: "empty",
      nameKey: "empty",
      descriptionKey: "empty",
      sections: [],
    };
    expect(flattenSectionIds(empty)).toEqual([]);
  });
});
