import { comprehensiveMedicalExam } from "./comprehensive-medical-exam";
import { basicSoap } from "./basic-soap";
import type { Template } from "./types";

export const TEMPLATES: Template[] = [basicSoap, comprehensiveMedicalExam];

export function getTemplateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function getDefaultTemplate(): Template {
  return basicSoap;
}

export { type Template, type TemplateSection } from "./types";
