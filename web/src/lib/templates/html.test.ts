import { describe, it, expect } from "vitest";
import { buildTemplateHtml, flattenSectionIds } from "./html";
import type { Template } from "./types";

const simpleTemplate: Template = {
  id: "simple",
  name: { sk: "Simple" },
  description: { sk: "Simple" },
  sections: [
    { id: "subjective", labels: { sk: "Subjektívne" } },
    { id: "objective", labels: { sk: "Objektívne" } },
    { id: "plan", labels: { sk: "Plán" } },
  ],
};

const nestedTemplate: Template = {
  id: "nested",
  name: { sk: "Nested" },
  description: { sk: "Nested" },
  sections: [
    {
      id: "exam",
      labels: { sk: "Vyšetrenie" },
      subsections: [
        { id: "vitals", labels: { sk: "Vitálne funkcie" } },
        { id: "skin", labels: { sk: "Koža" } },
      ],
    },
    { id: "plan", labels: { sk: "Plán" } },
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

  it("renders multiple lines as separate paragraphs", () => {
    const contents = {
      subjective: "Line one\nLine two",
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain("<p>Line one</p><p>Line two</p>");
  });

  it("uses section id as fallback label", () => {
    const contents = { subjective: "Text" };
    const html = buildTemplateHtml(simpleTemplate, contents, {});
    expect(html).toContain("<h2>subjective</h2>");
  });

  /* ── Inline formatting (bold/italic) ── */

  it("converts markdown **bold** to <strong> tags", () => {
    const contents = {
      subjective: "Patient has **severe headache** and **nausea**.",
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain(
      "<p>Patient has <strong>severe headache</strong> and <strong>nausea</strong>.</p>",
    );
  });

  it("preserves existing <strong> tags from editor round-trip", () => {
    const contents = {
      subjective:
        "Patient has <strong>severe headache</strong> and <strong>nausea</strong>.",
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain(
      "<p>Patient has <strong>severe headache</strong> and <strong>nausea</strong>.</p>",
    );
  });

  it("preserves <em> tags from editor round-trip", () => {
    const contents = {
      subjective: "Patient feels <em>slightly dizzy</em>.",
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain("<p>Patient feels <em>slightly dizzy</em>.</p>");
  });

  /* ── Bullet lists ── */

  it("converts - bullet lines to <ul><li>", () => {
    const contents = {
      subjective: "Symptoms:\n- Headache\n- Nausea\n- Dizziness",
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain("<p>Symptoms:</p>");
    expect(html).toContain(
      "<ul><li>Headache</li><li>Nausea</li><li>Dizziness</li></ul>",
    );
  });

  it("handles mixed paragraphs and bullet lists", () => {
    const contents = {
      subjective: "Intro text\n- Item A\n- Item B\nConclusion",
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain("<p>Intro text</p>");
    expect(html).toContain("<ul><li>Item A</li><li>Item B</li></ul>");
    expect(html).toContain("<p>Conclusion</p>");
  });

  it("preserves bold inside bullet items", () => {
    const contents = {
      subjective: "- **Aspirin** 200mg\n- **Heparin** 8000 UI",
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain(
      "<ul><li><strong>Aspirin</strong> 200mg</li><li><strong>Heparin</strong> 8000 UI</li></ul>",
    );
  });

  it("handles indented bullet lines", () => {
    const contents = {
      subjective: "  - Headache\n  - Nausea",
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain("<ul><li>Headache</li><li>Nausea</li></ul>");
  });

  it("handles en-dash and em-dash bullets", () => {
    const contents = {
      subjective: "– Item A\n— Item B\n* Item C",
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain(
      "<ul><li>Item A</li><li>Item B</li><li>Item C</li></ul>",
    );
  });

  it("escapes other HTML while preserving <strong> and <em>", () => {
    const contents = {
      subjective:
        "<strong>Bold</strong> & <script>xss</script> <em>italic</em>",
      objective: "",
      plan: "",
    };
    const html = buildTemplateHtml(simpleTemplate, contents, labels);
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
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
      name: { sk: "Empty" },
      description: { sk: "Empty" },
      sections: [],
    };
    expect(flattenSectionIds(empty)).toEqual([]);
  });
});
