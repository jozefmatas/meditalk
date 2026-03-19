import { comprehensiveMedicalExam } from "./comprehensive-medical-exam";
import { basicSoap } from "./basic-soap";
import type { Template, TemplateSection } from "./types";

/**
 * Static template registry — used as fallback when DB is not available.
 * Once DB migration runs, templates are fetched from Supabase.
 */
export const STATIC_TEMPLATES: Template[] = [
  comprehensiveMedicalExam,
  basicSoap,
];

/** @deprecated Use STATIC_TEMPLATES */
export const TEMPLATES = STATIC_TEMPLATES;

/**
 * Get a static template by ID (fallback for when DB is unavailable).
 */
export function getStaticTemplateById(id: string): Template | undefined {
  return STATIC_TEMPLATES.find((t) => t.id === id);
}

/** @deprecated Use getStaticTemplateById for fallback only */
export function getTemplateById(id: string): Template | undefined {
  return getStaticTemplateById(id);
}

export function getDefaultTemplate(): Template {
  return comprehensiveMedicalExam;
}

export {
  type Template,
  type TemplateSection,
  type DbTemplateRow,
  type TemplateInsights,
  dbRowToTemplate,
} from "./types";

export interface FlatSection {
  id: string;
  labelKey?: string;
  label?: string;
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
    result.push({
      id: section.id,
      labelKey: section.labelKey,
      label: section.label,
      level: 2,
    });
    if (section.subsections) {
      for (const sub of section.subsections) {
        result.push({
          id: sub.id,
          labelKey: sub.labelKey,
          label: sub.label,
          level: 3,
          parentId: section.id,
        });
      }
    }
  }
  return result;
}

/**
 * Resolve the display label for a section.
 * Custom templates: use section.label directly.
 * System templates: look up section.labelKey in the i18n sectionLabels dict.
 */
export function resolveSectionLabel(
  section: TemplateSection,
  sectionLabels?: Record<string, string>,
): string {
  if (section.label) return section.label;
  if (section.labelKey && sectionLabels?.[section.labelKey]) {
    return sectionLabels[section.labelKey];
  }
  return section.labelKey || section.id;
}

/**
 * Build a complete sectionLabels map for a template.
 * For system templates, uses the i18n lookup. For custom, uses stored labels.
 */
export function buildSectionLabelsMap(
  template: Template,
  i18nSections?: Record<string, string>,
): Record<string, string> {
  const labels: Record<string, string> = {};

  function collect(sections: TemplateSection[]) {
    for (const s of sections) {
      labels[s.id] = resolveSectionLabel(s, i18nSections);
      if (s.subsections) collect(s.subsections);
    }
  }

  collect(template.sections);
  return labels;
}
