import type { Template, TemplateSection } from "./types";

/**
 * Build structured HTML from a template and AI-generated section contents.
 * Uses section labels directly (already translated by the caller).
 */
export function buildTemplateHtml(
  template: Template,
  sectionContents: Record<string, string>,
  sectionLabels: Record<string, string>
): string {
  const parts: string[] = [];

  for (const section of template.sections) {
    parts.push(renderSection(section, sectionContents, sectionLabels, "h2"));
  }

  return parts.join("");
}

function renderSection(
  section: TemplateSection,
  contents: Record<string, string>,
  labels: Record<string, string>,
  headingLevel: "h2" | "h3"
): string {
  const label = labels[section.id] || section.id;
  const content = contents[section.id] || "";
  const parts: string[] = [];

  parts.push(`<${headingLevel}>${escapeHtml(label)}</${headingLevel}>`);

  if (content) {
    parts.push(`<p>${escapeHtml(content)}</p>`);
  }

  if (section.subsections) {
    for (const sub of section.subsections) {
      parts.push(renderSection(sub, contents, labels, "h3"));
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
