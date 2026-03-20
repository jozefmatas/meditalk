import { describe, it, expect } from "vitest";
import {
  parseNoteSections,
  parseNoteToSectionMap,
  sectionToPlainText,
  allSectionsToPlainText,
} from "./parse-note-sections";
import type { Template } from "./templates/types";

/* ── Helpers ── */

const simpleTemplate: Template = {
  id: "simple",
  name: { sk: "Simple" },
  description: { sk: "Simple" },
  sections: [
    { id: "subjective", labels: { sk: "Subjektívne" } },
    { id: "objective", labels: { sk: "Objektívne" } },
    { id: "assessment", labels: { sk: "Záver" } },
    { id: "plan", labels: { sk: "Plán" } },
  ],
};

const templateWithSubs: Template = {
  id: "with-subs",
  name: { sk: "With Subs" },
  description: { sk: "With Subs" },
  sections: [
    { id: "reason", labels: { sk: "Dôvod" } },
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

/* ── parseNoteSections ── */

describe("parseNoteSections", () => {
  it("returns empty array for empty input", () => {
    expect(parseNoteSections("")).toEqual([]);
  });

  it("parses simple h2 sections", () => {
    const html =
      "<h2>Subjective</h2><p>Patient reports headache.</p>" +
      "<h2>Objective</h2><p>BP 120/80.</p>";

    const result = parseNoteSections(html);
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
    const result = parseNoteSections(html);
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

  /* ── Inline formatting preservation ── */

  it("preserves <strong> tags in section content", () => {
    const html =
      "<h2>Subjective</h2><p>Patient reports <strong>severe headache</strong> and nausea.</p>" +
      "<h2>Objective</h2><p>BP 120/80.</p>" +
      "<h2>Assessment</h2><p><strong>Migraine</strong> with aura.</p>" +
      "<h2>Plan</h2><p>Ibuprofen 400mg PRN.</p>";

    const map = parseNoteToSectionMap(html, simpleTemplate);

    expect(map.subjective).toBe(
      "Patient reports <strong>severe headache</strong> and nausea.",
    );
    expect(map.assessment).toBe("<strong>Migraine</strong> with aura.");
    expect(map.objective).toBe("BP 120/80.");
  });

  it("preserves <em> tags in section content", () => {
    const html =
      "<h2>Subjective</h2><p>Patient feels <em>dizzy</em>.</p>" +
      "<h2>Objective</h2><p>Normal.</p>" +
      "<h2>Assessment</h2><p>Vertigo.</p>" +
      "<h2>Plan</h2><p>Rest.</p>";

    const map = parseNoteToSectionMap(html, simpleTemplate);

    expect(map.subjective).toBe("Patient feels <em>dizzy</em>.");
  });

  it("preserves <strong> in subsections", () => {
    const html =
      "<h2>Reason</h2><p>Checkup.</p>" +
      "<h2>Exam</h2><p>General.</p><h3>Vitals</h3><p>BP <strong>elevated</strong> at 150/90.</p><h3>Skin</h3><p>Clear.</p>" +
      "<h2>Plan</h2><p>Monitor.</p>";

    const map = parseNoteToSectionMap(html, templateWithSubs);

    expect(map.vitals).toBe("BP <strong>elevated</strong> at 150/90.");
  });

  it("converts <br> and paragraph breaks to newlines while preserving formatting", () => {
    const html =
      "<h2>Subjective</h2><p><strong>Headache</strong> for 3 days.<br>Also reports <em>nausea</em>.</p>" +
      "<h2>Objective</h2><p>Normal.</p>" +
      "<h2>Assessment</h2><p>Migraine.</p>" +
      "<h2>Plan</h2><p>Rest.</p>";

    const map = parseNoteToSectionMap(html, simpleTemplate);

    expect(map.subjective).toBe(
      "<strong>Headache</strong> for 3 days.\nAlso reports <em>nausea</em>.",
    );
  });

  /* ── Bullet list preservation ── */

  it("converts <ul><li> to - prefixed lines", () => {
    const html =
      "<h2>Subjective</h2><p>Symptoms:</p><ul><li>Headache</li><li>Nausea</li></ul>" +
      "<h2>Objective</h2><p>Normal.</p>" +
      "<h2>Assessment</h2><p>Migraine.</p>" +
      "<h2>Plan</h2><p>Rest.</p>";

    const map = parseNoteToSectionMap(html, simpleTemplate);

    expect(map.subjective).toBe("Symptoms:\n- Headache\n- Nausea");
  });

  it("handles <li><p>text</p></li> format (from TipTap editor)", () => {
    const html =
      "<h2>Subjective</h2><ul><li><p>Item A</p></li><li><p>Item B</p></li></ul>" +
      "<h2>Objective</h2><p>Normal.</p>" +
      "<h2>Assessment</h2><p>Ok.</p>" +
      "<h2>Plan</h2><p>Rest.</p>";

    const map = parseNoteToSectionMap(html, simpleTemplate);

    expect(map.subjective).toBe("- Item A\n- Item B");
  });

  it("preserves bold inside list items", () => {
    const html =
      "<h2>Subjective</h2><ul><li><strong>Aspirin</strong> 200mg</li><li><strong>Heparin</strong> 8000 UI</li></ul>" +
      "<h2>Objective</h2><p>Normal.</p>" +
      "<h2>Assessment</h2><p>Ok.</p>" +
      "<h2>Plan</h2><p>Rest.</p>";

    const map = parseNoteToSectionMap(html, simpleTemplate);

    expect(map.subjective).toBe(
      "- <strong>Aspirin</strong> 200mg\n- <strong>Heparin</strong> 8000 UI",
    );
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
