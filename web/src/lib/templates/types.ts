export interface TemplateSection {
  id: string;
  labels: Record<string, string>;
  context?: string;
  subsections?: TemplateSection[];
}

export interface Template {
  id: string;
  name: Record<string, string>;
  description: Record<string, string>;
  sections: TemplateSection[];
  systemPrompt?: string;
  styleExamples?: { name: string; text: string }[];
  specialties?: string[];
  isSystem?: boolean;
  sourceTemplateId?: string;
}
