/**
 * Client-side preview parser for reference-note uploads.
 *
 * Mirrors `web/src/lib/templates/reference-notes.ts` so the admin UI
 * can show which template sections a just-uploaded note will populate
 * BEFORE saving. Kept minimal — the runtime pipeline in web/ does the
 * real parsing at generation time; this is just the preview.
 */
import type { TemplateSection } from "./template-types";

export interface PerSectionPreview {
  sectionId: string;
  label: string;
  charCount: number;
  snippet: string;
}

export function previewReferenceNote(
  raw: string,
  sections: TemplateSection[],
): PerSectionPreview[] {
  if (!raw.trim() || sections.length === 0) return [];

  const labelIndex = buildFlatLabelIndex(sections);
  const idToLabel = new Map<string, string>();
  walk(sections, (s) => {
    const label =
      s.labels?.sk || s.labels?.en || Object.values(s.labels ?? {})[0] || s.id;
    idToLabel.set(s.id, label);
  });

  const lines = raw.split(/\r?\n/);
  let current: TemplateSection | null = null;
  const buckets = new Map<string, string[]>();

  for (const rawLine of lines) {
    const heading = extractHeadingLabel(rawLine);
    if (heading !== null) {
      const match = labelIndex.get(normalizeLabel(heading));
      if (match) {
        current = match;
        if (!buckets.has(current.id)) buckets.set(current.id, []);
        const same = getSameLineContent(rawLine);
        if (same) buckets.get(current.id)!.push(same);
        continue;
      }
    }
    if (current) {
      const arr = buckets.get(current.id);
      if (arr) arr.push(rawLine);
    }
  }

  const out: PerSectionPreview[] = [];
  for (const [sectionId, linesArr] of buckets.entries()) {
    const text = linesArr.join("\n").trim();
    if (!text) continue;
    out.push({
      sectionId,
      label: idToLabel.get(sectionId) ?? sectionId,
      charCount: text.length,
      snippet: text.length > 120 ? text.slice(0, 117) + "…" : text,
    });
  }
  return out;
}

// ─── internals (mirrored from web parser) ──────────────────────────────

function walk(
  sections: TemplateSection[],
  fn: (s: TemplateSection) => void,
): void {
  for (const s of sections) {
    fn(s);
    if (s.subsections?.length) walk(s.subsections, fn);
  }
}

function buildFlatLabelIndex(
  sections: TemplateSection[],
): Map<string, TemplateSection> {
  const out = new Map<string, TemplateSection>();
  walk(sections, (s) => {
    for (const label of Object.values(s.labels ?? {})) {
      if (typeof label !== "string") continue;
      const key = normalizeLabel(label);
      if (!key || out.has(key)) continue;
      out.set(key, s);
    }
  });
  return out;
}

function normalizeLabel(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const MD_HEADING_RE = /^\s*#{1,6}\s+(.+?)\s*$/;
const BOLD_LABEL_RE = /^\s*\*\*\s*(.+?)\s*\*\*\s*:?\s*$/;
const COLON_LABEL_RE = /^\s*([\p{L}][\p{L}\p{N}\s()\-/]{0,40}?)\s*:\s*(.*)$/u;
const BARE_LABEL_RE = /^\s*([\p{L}][\p{L}\p{N}\s()\-/]{0,40}?)\s*$/u;

function extractHeadingLabel(line: string): string | null {
  const md = MD_HEADING_RE.exec(line);
  if (md) return md[1];
  const bold = BOLD_LABEL_RE.exec(line);
  if (bold) return bold[1];
  const colon = COLON_LABEL_RE.exec(line);
  if (colon && !/[,.!?;]$/.test(colon[1])) {
    const words = colon[1].split(" ").length;
    if (words <= 5) return colon[1];
  }
  const bare = BARE_LABEL_RE.exec(line);
  if (bare) {
    const words = bare[1].split(" ").length;
    if (words <= 4) return bare[1];
  }
  return null;
}

function getSameLineContent(line: string): string {
  const colon = COLON_LABEL_RE.exec(line);
  if (colon && colon[2] && colon[2].trim()) return colon[2].trim();
  return "";
}
