import type { Template, TemplateSection } from "./types";

/** Values the AI uses for sections with no relevant information. */
const NOT_STATED = new Set(["Not stated", "Neuvedené", "Neuvedeno"]);

interface BuildOptions {
  /** When true, sections with empty or "Not stated" content are omitted. */
  skipEmpty?: boolean;
}

/**
 * Build structured HTML from a template and AI-generated section contents.
 * Uses section labels directly (already translated by the caller).
 */
export function buildTemplateHtml(
  template: Template,
  sectionContents: Record<string, string>,
  sectionLabels: Record<string, string>,
  options?: BuildOptions,
): string {
  const parts: string[] = [];

  for (const section of template.sections) {
    const html = renderSection(
      section,
      sectionContents,
      sectionLabels,
      "h2",
      options,
    );
    if (html) parts.push(html);
  }

  return parts.join("");
}

/**
 * Check whether a section (and all its subsections) have meaningful content.
 */
function hasContent(
  section: TemplateSection,
  contents: Record<string, string>,
): boolean {
  const value = (contents[section.id] || "").trim();
  if (value && !NOT_STATED.has(value)) return true;

  if (section.subsections) {
    for (const sub of section.subsections) {
      if (hasContent(sub, contents)) return true;
    }
  }

  return false;
}

function renderSection(
  section: TemplateSection,
  contents: Record<string, string>,
  labels: Record<string, string>,
  headingLevel: "h2" | "h3",
  options?: BuildOptions,
): string {
  if (options?.skipEmpty && !hasContent(section, contents)) {
    return "";
  }

  const label = labels[section.id] || section.id;
  const content = contents[section.id] || "";
  const parts: string[] = [];

  parts.push(`<${headingLevel}>${escapeHtml(label)}</${headingLevel}>`);

  if (content && !(options?.skipEmpty && NOT_STATED.has(content.trim()))) {
    parts.push(renderContent(content));
  }

  if (section.subsections) {
    for (const sub of section.subsections) {
      const html = renderSection(sub, contents, labels, "h3", options);
      if (html) parts.push(html);
    }
  }

  return parts.join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Format a single line of text for embedding in HTML.
 * - Converts markdown **bold** to <strong> tags
 * - Preserves existing <strong>/<em> tags (from editor round-trip)
 * - Escapes all other HTML entities
 */
function formatInlineText(text: string): string {
  // Convert markdown **bold** to placeholders (before escaping)
  let result = text.replace(/\*\*(.+?)\*\*/g, "\x00S\x00$1\x00/S\x00");

  // Preserve existing <strong> and <em> tags as placeholders
  result = result
    .replace(/<strong>/gi, "\x00S\x00")
    .replace(/<\/strong>/gi, "\x00/S\x00")
    .replace(/<em>/gi, "\x00E\x00")
    .replace(/<\/em>/gi, "\x00/E\x00");

  // Escape all remaining HTML
  result = escapeHtml(result);

  // Restore formatting tags
  return result
    .replace(/\x00S\x00/g, "<strong>")
    .replace(/\x00\/S\x00/g, "</strong>")
    .replace(/\x00E\x00/g, "<em>")
    .replace(/\x00\/E\x00/g, "</em>");
}

/**
 * Render section content as HTML, converting:
 * - Lines starting with "- " or "• " into <ul><li> lists
 * - Other lines into <p> paragraphs
 * - Inline **bold** and <strong>/<em> formatting
 */
/** Matches bullet-style list lines: - , • , – , — , *  (with optional leading whitespace) */
const BULLET_RE = /^\s*[-•–—*]\s/;

function renderContent(content: string): string {
  const lines = content.split("\n");
  const parts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (BULLET_RE.test(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(formatInlineText(lines[i].replace(/^\s*[-•–—*]\s/, "")));
        i++;
      }
      parts.push(
        `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`,
      );
    } else if (lines[i].trim()) {
      parts.push(`<p>${formatInlineText(lines[i])}</p>`);
      i++;
    } else {
      i++;
    }
  }

  return parts.join("");
}

/**
 * Flatten all section IDs from a template (including subsections).
 */
export function flattenSectionIds(template: Template): string[] {
  const ids: string[] = [];

  function collect(sections: TemplateSection[]) {
    for (const s of sections) {
      ids.push(s.id);
      if (s.subsections) collect(s.subsections);
    }
  }

  collect(template.sections);
  return ids;
}
