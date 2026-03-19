import { comprehensiveMedicalExam } from "./comprehensive-medical-exam";
import { basicSoap } from "./basic-soap";
import { focusedCardiologyExam } from "./focused-cardiology-exam";
import { comprehensiveCardiologyExam } from "./comprehensive-cardiology-exam";
import type { Template } from "./types";

export const TEMPLATES: Template[] = [
  comprehensiveMedicalExam,
  basicSoap,
  focusedCardiologyExam,
  comprehensiveCardiologyExam,
];

export function getTemplateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function getDefaultTemplate(): Template {
  return comprehensiveMedicalExam;
}

export { type Template, type TemplateSection } from "./types";

export interface FlatSection {
  id: string;
  labelKey: string;
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
    result.push({ id: section.id, labelKey: section.labelKey, level: 2 });
    if (section.subsections) {
      for (const sub of section.subsections) {
        result.push({
          id: sub.id,
          labelKey: sub.labelKey,
          level: 3,
          parentId: section.id,
        });
      }
    }
  }
  return result;
}
