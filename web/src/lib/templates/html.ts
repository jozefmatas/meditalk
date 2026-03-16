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
    // Preserve newlines from AI output as <br> tags
    parts.push(`<p>${escapeHtml(content).replace(/\n/g, "<br>")}</p>`);
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
