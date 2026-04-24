/**
 * Declarative section classification — mirror of `web/src/lib/templates/types.ts`.
 * Drives per-section behaviour (voice-example suppression, digit-grounding,
 * Haiku-vs-Sonnet critic, skip-render in the main loop).
 */
export type SectionKind =
  | "default"
  | "history-narrative"
  | "vital-numeric"
  | "exam-narrative"
  | "medication-list"
  | "conclusion";

export interface TemplateSection {
  id: string;
  labels: Record<string, string>;
  context?: string;
  subsections?: TemplateSection[];
  /** Claude model tier for this section (haiku / sonnet / opus). Preserved on save. */
  model?: "haiku" | "sonnet" | "opus";
  /**
   * Declarative classification — when omitted, the generation pipeline
   * falls back to label-matching and logs a warning per hit.
   */
  kind?: SectionKind;
  /** Named post-render reconcilers. Preserved on save. */
  reconcilers?: string[];
  /** Backup of prior context before a script rewrite. Preserved on save. */
  previousContext?: string;
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
