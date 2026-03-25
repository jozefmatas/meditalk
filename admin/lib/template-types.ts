export interface TemplateSection {
  id: string;
  labels: Record<string, string>;
  context?: string;
  subsections?: TemplateSection[];
}

export interface TemplateRow {
  id: string;
  name: Record<string, string>;
  description: Record<string, string>;
  sections: TemplateSection[];
  system_prompt: string | null;
  style_examples: { name: string; text: string }[] | null;
  style_guide: string | null;
  specialties: string[];
  locales: string[];
  is_system: boolean;
  visible: boolean;
  sort_order: number;
  source_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export const LOCALES = ["sk", "en", "cs"] as const;
export type Locale = (typeof LOCALES)[number];
export const PRIMARY_LOCALE: Locale = "sk";
export const TRANSLATION_LOCALES: Locale[] = ["en", "cs"];
