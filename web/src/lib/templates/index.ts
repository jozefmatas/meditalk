import { nanoid } from "nanoid";
import type { Template, TemplateSection } from "./types";

/** The default template used for new encounters. */
export const DEFAULT_TEMPLATE_ID = "t_UjVsxUoQxc";

export { type Template, type TemplateSection } from "./types";

/** Generate a unique section ID: "s_" + 10-char nanoid. */
export function generateSectionId(): string {
  return `s_${nanoid(10)}`;
}

/** Resolve a section's display label for a given locale, with fallback chain. */
export function resolveSectionLabel(
  section: TemplateSection,
  locale: string,
): string {
  return section.labels[locale] ?? section.labels.sk ?? section.id;
}

/** Build a { [sectionId]: label } map from a template for a given locale. */
export function buildSectionLabelsFromTemplate(
  template: Template,
  locale: string,
): Record<string, string> {
  const labels: Record<string, string> = {};
  function collect(sections: TemplateSection[]) {
    for (const s of sections) {
      labels[s.id] = resolveSectionLabel(s, locale);
      if (s.subsections) collect(s.subsections);
    }
  }
  collect(template.sections);
  return labels;
}

/** Build a { [sectionId]: context } map from a template (only sections with context). */
export function buildSectionContextsFromTemplate(
  template: Template,
): Record<string, string> {
  const contexts: Record<string, string> = {};
  function collect(sections: TemplateSection[]) {
    for (const s of sections) {
      if (s.context) contexts[s.id] = s.context;
      if (s.subsections) collect(s.subsections);
    }
  }
  collect(template.sections);
  return contexts;
}

export interface FlatSection {
  id: string;
  labels: Record<string, string>;
  level: 2 | 3;
  parentId?: string;
}

/**
 * Flatten a template's section tree into a flat array with heading levels.
 * Top-level sections → level 2 (h2), subsections → level 3 (h3).
 */
export function flattenTemplateSections(template: Template): FlatSection[] {
  const result: FlatSection[] = [];
  for (const section of template.sections) {
    result.push({ id: section.id, labels: section.labels, level: 2 });
    if (section.subsections) {
      for (const sub of section.subsections) {
        result.push({
          id: sub.id,
          labels: sub.labels,
          level: 3,
          parentId: section.id,
        });
      }
    }
  }
  return result;
}
