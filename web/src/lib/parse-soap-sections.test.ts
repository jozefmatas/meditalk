import { describe, it, expect } from "vitest";
import {
  parseSoapSections,
  parseNoteToSectionMap,
  sectionToPlainText,
  allSectionsToPlainText,
} from "./parse-soap-sections";
import type { Template } from "./templates/types";

/* ── Helpers ── */

const simpleTemplate: Template = {
  id: "simple",
  nameKey: "simple",
  descriptionKey: "simple",
  sections: [
    { id: "subjective", labelKey: "subjective" },
    { id: "objective", labelKey: "objective" },
    { id: "assessment", labelKey: "assessment" },
    { id: "plan", labelKey: "plan" },
  ],
};

const templateWithSubs: Template = {
  id: "with-subs",
  nameKey: "with-subs",
  descriptionKey: "with-subs",
  sections: [
    { id: "reason", labelKey: "reason" },
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

/* ── parseSoapSections ── */

describe("parseSoapSections", () => {
  it("returns empty array for empty input", () => {
    expect(parseSoapSections("")).toEqual([]);
  });

  it("parses simple h2 sections", () => {
    const html =
      "<h2>Subjective</h2><p>Patient reports headache.</p>" +
      "<h2>Objective</h2><p>BP 120/80.</p>";

    const result = parseSoapSections(html);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "subjective",
      title: "Subjective",
      content: "<p>Patient reports headache.</p>",
    });
    expect(result[1]).toEqual({
      id: "objective",
      title: "Objective",
      content: "<p>BP 120/80.</p>",
    });
  });

  it("decodes HTML entities in titles", () => {
    const html = "<h2>Signs &amp; Symptoms</h2><p>Content</p>";
    const result = parseSoapSections(html);
    expect(result[0].title).toBe("Signs & Symptoms");
  });
});

/* ── parseNoteToSectionMap ── */

describe("parseNoteToSectionMap", () => {
  it("returns empty object for empty HTML", () => {
    expect(parseNoteToSectionMap("", simpleTemplate)).toEqual({});
  });

  it("maps h2 sections by template index", () => {
    const html =
      "<h2>Subjective</h2><p>Headache for 3 days.</p>" +
      "<h2>Objective</h2><p>BP 120/80.</p>" +
      "<h2>Assessment</h2><p>Tension headache.</p>" +
      "<h2>Plan</h2><p>Ibuprofen 400mg PRN.</p>";

    const map = parseNoteToSectionMap(html, simpleTemplate);

    expect(map.subjective).toBe("Headache for 3 days.");
    expect(map.objective).toBe("BP 120/80.");
    expect(map.assessment).toBe("Tension headache.");
    expect(map.plan).toBe("Ibuprofen 400mg PRN.");
  });

  it("extracts subsection content from h3 tags", () => {
    const html =
      "<h2>Reason</h2><p>Checkup.</p>" +
      "<h2>Exam</h2><p>General notes.</p><h3>Vitals</h3><p>BP 120/80.</p><h3>Skin</h3><p>Clear.</p>" +
      "<h2>Plan</h2><p>Follow up in 3 months.</p>";

    const map = parseNoteToSectionMap(html, templateWithSubs);

    expect(map.reason).toBe("Checkup.");
    expect(map.exam).toBe("General notes.");
    expect(map.vitals).toBe("BP 120/80.");
    expect(map.skin).toBe("Clear.");
    expect(map.plan).toBe("Follow up in 3 months.");
  });

  it("handles sections with no parent content before subsections", () => {
    const html =
      "<h2>Reason</h2><p>Checkup.</p>" +
      "<h2>Exam</h2><h3>Vitals</h3><p>Normal.</p><h3>Skin</h3><p>Clear.</p>" +
      "<h2>Plan</h2><p>None.</p>";

    const map = parseNoteToSectionMap(html, templateWithSubs);

    expect(map.exam).toBe("");
    expect(map.vitals).toBe("Normal.");
    expect(map.skin).toBe("Clear.");
  });

  /* ── NOT_STATED filtering ── */

  it('filters "Neuvedené" (Slovak) to empty string', () => {
    const html =
      "<h2>Subjective</h2><p>Headache.</p>" +
      "<h2>Objective</h2><p>Neuvedené</p>" +
      "<h2>Assessment</h2><p>Migraine.</p>" +
      "<h2>Plan</h2><p>Neuvedené</p>";

    const map = parseNoteToSectionMap(html, simpleTemplate);

    expect(map.subjective).toBe("Headache.");
    expect(map.objective).toBe("");
    expect(map.assessment).toBe("Migraine.");
    expect(map.plan).toBe("");
  });

  it('filters "Neuvedeno" (Czech) to empty string', () => {
    const html =
      "<h2>Subjective</h2><p>Neuvedeno</p>" +
      "<h2>Objective</h2><p>BP 120/80.</p>" +
      "<h2>Assessment</h2><p>Neuvedeno</p>" +
      "<h2>Plan</h2><p>Rest.</p>";

    const map = parseNoteToSectionMap(html, simpleTemplate);

    expect(map.subjective).toBe("");
    expect(map.objective).toBe("BP 120/80.");
    expect(map.assessment).toBe("");
    expect(map.plan).toBe("Rest.");
  });

  it('filters "Not stated" (English) to empty string', () => {
    const html =
      "<h2>Subjective</h2><p>Not stated</p>" +
      "<h2>Objective</h2><p>Not stated</p>" +
      "<h2>Assessment</h2><p>Not stated</p>" +
      "<h2>Plan</h2><p>Not stated</p>";

    const map = parseNoteToSectionMap(html, simpleTemplate);

    expect(Object.values(map).every((v) => v === "")).toBe(true);
  });

  it("filters NOT_STATED in subsections too", () => {
    const html =
      "<h2>Reason</h2><p>Checkup.</p>" +
      "<h2>Exam</h2><p>Neuvedené</p><h3>Vitals</h3><p>BP 120/80.</p><h3>Skin</h3><p>Neuvedené</p>" +
      "<h2>Plan</h2><p>Follow up.</p>";

    const map = parseNoteToSectionMap(html, templateWithSubs);

    expect(map.reason).toBe("Checkup.");
    expect(map.exam).toBe("");
    expect(map.vitals).toBe("BP 120/80.");
    expect(map.skin).toBe("");
    expect(map.plan).toBe("Follow up.");
  });

  it("does not filter similar but non-exact text", () => {
    const html =
      "<h2>Subjective</h2><p>Not stated by the patient explicitly.</p>" +
      "<h2>Objective</h2><p>Neuvedené údaje.</p>" +
      "<h2>Assessment</h2><p>Assessment.</p>" +
      "<h2>Plan</h2><p>Plan.</p>";

    const map = parseNoteToSectionMap(html, simpleTemplate);

    expect(map.subjective).toBe("Not stated by the patient explicitly.");
    expect(map.objective).toBe("Neuvedené údaje.");
  });
});

/* ── sectionToPlainText ── */

describe("sectionToPlainText", () => {
  it("formats section as markdown-style text", () => {
    const section = {
      id: "subjective",
      title: "Subjective",
      content: "<p>Headache for 3 days.</p>",
    };

    const result = sectionToPlainText(section);
    expect(result).toBe("**Subjective**\nHeadache for 3 days.");
  });
});

/* ── allSectionsToPlainText ── */

describe("allSectionsToPlainText", () => {
  it("joins sections with blank lines", () => {
    const sections = [
      { id: "s1", title: "A", content: "<p>Content A</p>" },
      { id: "s2", title: "B", content: "<p>Content B</p>" },
    ];

    const result = allSectionsToPlainText(sections);
    expect(result).toBe("**A**\nContent A\n\n**B**\nContent B");
  });
});
