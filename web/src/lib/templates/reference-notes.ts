/**
 * Reference-note corpus — per-section attending examples.
 *
 * A reference note is a full finished clinical note written by a senior
 * attending. We parse it into per-section snippets and hand those to the
 * section-agent as few-shot voice examples. Style emerges from the
 * corpus; no prompt rules needed.
 *
 * Storage lives on `template.styleExamples: { name; text }[]` (jsonb in
 * Supabase). Parsing runs at generation time against the live template —
 * cheap enough (<2 ms for a 5-note corpus) that we don't cache it.
 */
import type { Template } from "./types";
import type { TemplateSection } from "./types";
import { buildFlatLabelIndex, normalizeLabel } from "../parse-note-sections";

/** Max characters kept per example. Opening sentences carry the voice. */
const MAX_EXAMPLE_CHARS = 500;

/** Max examples per section shown to the LLM. */
const MAX_EXAMPLES_PER_SECTION = 3;

/**
 * Split a single reference note into per-section snippets keyed by
 * `TemplateSection.id`. Recognises heading shapes:
 *   `## Label`              (markdown heading)
 *   `**Label**`             (bold label)
 *   `Label`                 (bare label on its own line, next line = content)
 *   `Label:`                (label followed by colon)
 *
 * Labels are matched against every locale-label stored on every section
 * AND subsection in the template, diacritic-stripped and case-insensitive
 * (via `buildFlatLabelIndex` + `normalizeLabel`). Doctors usually write
 * sections flat — they don't nest subsections under their parent — so
 * the flat index covers every heading they might drop in.
 */
export function parseReferenceNote(
  raw: string,
  template: Template,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw.trim()) return out;

  const labelIndex = buildFlatLabelIndex(template.sections);
  const lines = raw.split(/\r?\n/);

  let currentSection: TemplateSection | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!currentSection) return;
    const text = buffer.join("\n").trim();
    if (text) {
      const existing = out.get(currentSection.id);
      out.set(currentSection.id, existing ? `${existing}\n${text}` : text);
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const heading = extractHeadingLabel(rawLine);
    if (heading !== null) {
      const match = labelIndex.get(normalizeLabel(heading));
      if (match) {
        flush();
        currentSection = match;
        // Content on the same line after "Label:" — keep it.
        const sameLineRest = getSameLineContent(rawLine);
        if (sameLineRest) buffer.push(sameLineRest);
        continue;
      }
      // Heading-shaped line that doesn't match any template label — treat
      // as regular content inside the current section (the doctor might
      // have headings we don't recognise; don't drop the content).
    }
    if (currentSection) buffer.push(rawLine);
  }
  flush();

  return out;
}

/**
 * Build a Map<sectionId, string[]> spanning every attached reference
 * note. Examples per section are round-robin-selected across notes so
 * each note contributes before any note repeats. Deterministic — same
 * inputs produce the same map. Each example is hard-capped at
 * MAX_EXAMPLE_CHARS (trimmed at the nearest word boundary).
 */
export function buildSectionExamplesMap(
  styleExamples: Template["styleExamples"],
  template: Template,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!styleExamples?.length) return out;

  // Parse each attached note once. parsedPerNote[i] = Map<sectionId, text>.
  const parsedPerNote: Map<string, string>[] = styleExamples.map((ex) =>
    parseReferenceNote(ex.text, template),
  );

  // Collect the set of section IDs any note touched.
  const touchedIds = new Set<string>();
  for (const m of parsedPerNote) for (const id of m.keys()) touchedIds.add(id);

  for (const sectionId of touchedIds) {
    const chosen: string[] = [];
    // Round-robin: note 0, note 1, … then back to 0 on second pass.
    for (
      let round = 0;
      round < MAX_EXAMPLES_PER_SECTION &&
      chosen.length < MAX_EXAMPLES_PER_SECTION;
      round++
    ) {
      for (const note of parsedPerNote) {
        if (chosen.length >= MAX_EXAMPLES_PER_SECTION) break;
        const text = note.get(sectionId);
        if (!text) continue;
        const trimmed = trimExample(text);
        if (!trimmed) continue;
        if (chosen.includes(trimmed)) continue; // identical duplicates
        if (
          round === 0 ||
          !chosen.some((c) => c.startsWith(trimmed.slice(0, 40)))
        ) {
          chosen.push(trimmed);
        }
      }
    }
    if (chosen.length) out.set(sectionId, chosen);
  }

  return out;
}

// ─── internals ────────────────────────────────────────────────────────

const MD_HEADING_RE = /^\s*#{1,6}\s+(.+?)\s*$/;
const BOLD_LABEL_RE = /^\s*\*\*\s*(.+?)\s*\*\*\s*:?\s*$/;
const COLON_LABEL_RE = /^\s*([\p{L}][\p{L}\p{N}\s()\-/]{0,40}?)\s*:\s*(.*)$/u;
const BARE_LABEL_RE = /^\s*([\p{L}][\p{L}\p{N}\s()\-/]{0,40}?)\s*$/u;

/**
 * Pull the label text out of a potential heading line. Returns null when
 * the line is clearly not a heading (too long, has sentence punctuation,
 * starts with a bullet).
 */
function extractHeadingLabel(line: string): string | null {
  const md = MD_HEADING_RE.exec(line);
  if (md) return md[1];

  const bold = BOLD_LABEL_RE.exec(line);
  if (bold) return bold[1];

  // "Label: content-on-same-line" → label part only.
  const colon = COLON_LABEL_RE.exec(line);
  if (colon && !/[,.!?;]$/.test(colon[1])) {
    // Reject if the "label" contains sentence-ending punctuation, which
    // would indicate it's a real sentence ending with a colon rather than
    // a section heading. (E.g. "Pacientka sa cíti dobre: opuchy neguje.")
    const labelChars = colon[1].split(" ").length;
    if (labelChars <= 5) return colon[1];
  }

  // Bare label line (short, letters-only, no terminal punctuation).
  const bare = BARE_LABEL_RE.exec(line);
  if (bare) {
    const words = bare[1].split(" ").length;
    if (words <= 4) return bare[1];
  }

  return null;
}

/**
 * If the heading line contained `Label: <text>`, return just the text
 * portion so it becomes the first buffered content line of that section.
 */
function getSameLineContent(line: string): string {
  const colon = COLON_LABEL_RE.exec(line);
  if (colon && colon[2] && colon[2].trim()) return colon[2].trim();
  return "";
}

/**
 * Cap an example at MAX_EXAMPLE_CHARS and break at the nearest word
 * boundary so we don't slice a word in half.
 */
function trimExample(text: string): string {
  const collapsed = text.replace(/\n{3,}/g, "\n\n").trim();
  if (collapsed.length <= MAX_EXAMPLE_CHARS) return collapsed;
  const cut = collapsed.slice(0, MAX_EXAMPLE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > MAX_EXAMPLE_CHARS * 0.8
    ? cut.slice(0, lastSpace).trim() + "…"
    : cut.trim() + "…";
}
