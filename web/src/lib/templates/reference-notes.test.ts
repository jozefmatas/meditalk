// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseReferenceNote, buildSectionExamplesMap } from "./reference-notes";
import type { Template } from "./types";

function makeTemplate(): Template {
  return {
    id: "t_cardio",
    name: { sk: "Cardio" },
    description: {},
    sections: [
      {
        id: "s_anam",
        labels: { sk: "Anamnézy", en: "History" },
        subsections: [
          { id: "s_ra", labels: { sk: "RA", en: "FHx" } },
          { id: "s_oa", labels: { sk: "OA", en: "PMHx" } },
          { id: "s_aa", labels: { sk: "AA", en: "Allergies" } },
          { id: "s_la", labels: { sk: "LA", en: "Medications" } },
        ],
      },
      {
        id: "s_obj",
        labels: { sk: "Objektívne vyšetrenie", en: "Objective" },
        subsections: [
          { id: "s_tk", labels: { sk: "Krvný tlak", en: "BP" } },
          { id: "s_puls", labels: { sk: "Pulz", en: "Pulse" } },
          { id: "s_ekg", labels: { sk: "EKG", en: "EKG" } },
        ],
      },
      { id: "s_zaver", labels: { sk: "Záver", en: "Assessment" } },
    ],
  };
}

describe("parseReferenceNote", () => {
  it("parses markdown `## Label` headings", () => {
    const note = `## RA
Otec mal infarkt vo veku 60 rokov.

## OA
Arteriová hypertenzia III. stupňa.

## Záver
I10 Primárna artériová hypertenzia.`;
    const map = parseReferenceNote(note, makeTemplate());
    expect(map.get("s_ra")).toContain("Otec mal infarkt");
    expect(map.get("s_oa")).toContain("hypertenzia III");
    expect(map.get("s_zaver")).toContain("I10");
  });

  it("parses bare `Label\\ncontent` headings", () => {
    const note = `RA
Otec zomrel na cukrovku.

OA
DM II. typu, hypertenzia.`;
    const map = parseReferenceNote(note, makeTemplate());
    expect(map.get("s_ra")).toContain("cukrovku");
    expect(map.get("s_oa")).toContain("DM II");
  });

  it("parses `**Label**` bold headings", () => {
    const note = `**RA**
Bez rodinnej záťaže.

**OA**
Hypertenzia.`;
    const map = parseReferenceNote(note, makeTemplate());
    expect(map.get("s_ra")).toContain("Bez rodinnej");
    expect(map.get("s_oa")).toContain("Hypertenzia");
  });

  it("parses `Label: content` same-line format", () => {
    const note = `RA: bez pozoruhodnej anamnézy.
OA: ICHS, hypertenzia III.
AA: negovaná.`;
    const map = parseReferenceNote(note, makeTemplate());
    expect(map.get("s_ra")).toBe("bez pozoruhodnej anamnézy.");
    expect(map.get("s_oa")).toBe("ICHS, hypertenzia III.");
    expect(map.get("s_aa")).toBe("negovaná.");
  });

  it("maps subsection headings into their own IDs (no cascade under parent)", () => {
    const note = `Krvný tlak
TK ĽHK 140/80 mmHg.

Pulz
70/min, pravidelný.

EKG
Sinus rytmus, f 70/min.`;
    const map = parseReferenceNote(note, makeTemplate());
    expect(map.get("s_tk")).toContain("140/80");
    expect(map.get("s_puls")).toContain("70/min");
    expect(map.get("s_ekg")).toContain("Sinus rytmus");
    // Parent "Objektívne vyšetrenie" was never written as a heading — no entry.
    expect(map.has("s_obj")).toBe(false);
  });

  it("is diacritic- and case-insensitive on labels", () => {
    const note = `ZAVER
I10 Hypertenzia.

OBJEKTIVNE VYSETRENIE
(ignored — parent wasn't emitted above because this IS a heading)`;
    const map = parseReferenceNote(note, makeTemplate());
    expect(map.get("s_zaver")).toContain("I10");
  });

  it("matches English locale labels too", () => {
    const note = `FHx
Mother: breast cancer.

Allergies
NKDA.`;
    const map = parseReferenceNote(note, makeTemplate());
    expect(map.get("s_ra")).toContain("breast cancer");
    expect(map.get("s_aa")).toContain("NKDA");
  });

  it("does not create entries for sections with empty content", () => {
    const note = `## RA

## OA
Content here.`;
    const map = parseReferenceNote(note, makeTemplate());
    expect(map.has("s_ra")).toBe(false);
    expect(map.get("s_oa")).toContain("Content here");
  });

  it("treats heading-shaped lines that match no label as content", () => {
    const note = `## RA
Subtitle that is NOT a template label:
actual family history content here.`;
    const map = parseReferenceNote(note, makeTemplate());
    const ra = map.get("s_ra") ?? "";
    expect(ra).toContain("actual family history");
    expect(ra).toContain("Subtitle");
  });

  it("returns an empty map for empty input", () => {
    const map = parseReferenceNote("", makeTemplate());
    expect(map.size).toBe(0);
  });
});

describe("buildSectionExamplesMap", () => {
  it("returns empty map when no styleExamples are attached", () => {
    const map = buildSectionExamplesMap([], makeTemplate());
    expect(map.size).toBe(0);
    const mapU = buildSectionExamplesMap(undefined, makeTemplate());
    expect(mapU.size).toBe(0);
  });

  it("collects examples from multiple notes, one per section", () => {
    const examples = [
      {
        name: "note1.md",
        text: `## RA
Mother: stroke.
## AA
Alergia na lieky negovaná.`,
      },
      {
        name: "note2.md",
        text: `## RA
Father: MI.
## AA
Alergia na lieky a kontrastné látky negovaná.`,
      },
    ];
    const map = buildSectionExamplesMap(examples, makeTemplate());
    expect(map.get("s_ra")?.length).toBe(2);
    expect(map.get("s_ra")?.[0]).toContain("Mother: stroke");
    expect(map.get("s_ra")?.[1]).toContain("Father: MI");
    expect(map.get("s_aa")?.length).toBe(2);
  });

  it("caps examples per section at 3 even when 5 notes are attached", () => {
    const examples = Array.from({ length: 5 }, (_, i) => ({
      name: `note${i}.md`,
      text: `## RA\nNote ${i} content.`,
    }));
    const map = buildSectionExamplesMap(examples, makeTemplate());
    expect(map.get("s_ra")?.length).toBe(3);
  });

  it("trims individual examples to ≤500 characters without breaking mid-word", () => {
    const longText = "slovo ".repeat(200); // ~1200 chars of "slovo "
    const examples = [{ name: "long.md", text: `## RA\n${longText}` }];
    const map = buildSectionExamplesMap(examples, makeTemplate());
    const ex = map.get("s_ra")?.[0] ?? "";
    expect(ex.length).toBeLessThanOrEqual(501); // 500 + ellipsis
    expect(ex.endsWith("slovo…") || ex.endsWith("slovo")).toBe(true);
  });

  it("handles a note that covers only a subset of sections", () => {
    const examples = [
      {
        name: "only-ra.md",
        text: `## RA
Just one section here.`,
      },
    ];
    const map = buildSectionExamplesMap(examples, makeTemplate());
    expect(map.get("s_ra")?.[0]).toContain("Just one section");
    expect(map.has("s_oa")).toBe(false);
    expect(map.has("s_aa")).toBe(false);
  });

  it("is deterministic — same input produces same output", () => {
    const examples = [
      { name: "a.md", text: "## RA\nA\n## OA\nA-oa" },
      { name: "b.md", text: "## RA\nB\n## OA\nB-oa" },
      { name: "c.md", text: "## RA\nC\n## OA\nC-oa" },
    ];
    const map1 = buildSectionExamplesMap(examples, makeTemplate());
    const map2 = buildSectionExamplesMap(examples, makeTemplate());
    expect(map1.get("s_ra")).toEqual(map2.get("s_ra"));
    expect(map1.get("s_oa")).toEqual(map2.get("s_oa"));
  });
});
