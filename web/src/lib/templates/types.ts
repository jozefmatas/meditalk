/**
 * Declarative classification of what a section holds.
 *
 * The `kind` drives per-section behaviour — render model tier (Sonnet
 * for narrative/conclusion, Haiku for structural/default), voice-example
 * suppression, digit-grounding on vitals, critic model (always Haiku).
 *
 * Values:
 *   - "default"            — narrative prose (RA, SA, PA, EA, Ab, …). Haiku render.
 *   - "history-narrative"  — TO-style HPI synthesis. Sonnet render.
 *   - "vital-numeric"      — single-value vitals (Výška/Hmotnosť/BMI/TK/
 *                            Pulz/EKG); Haiku render, digit-grounded, voice examples off.
 *   - "exam-narrative"     — Celkové vyšetrenie / Fyzikálne vyšetrenie;
 *                            Sonnet render, voice examples off.
 *   - "medication-list"    — LA; Haiku render + critic, drug-normalizer.
 *   - "conclusion"         — Záver; DETERMINISTIC (no LLM). Canonical ICD
 *                            descriptions from suggester, one per line.
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
  /**
   * Clinical contract for this section — the admin-editable instruction
   * the section-agent uses as its system prompt. Specifies what belongs
   * here, what to exclude, and the expected output format.
   */
  context?: string;
  subsections?: TemplateSection[];
  /**
   * Declarative classification. When omitted, the pipeline falls back to
   * label-matching (legacy behaviour) and logs a warning per fallback
   * hit. New sections should always set this; backfill migration brings
   * existing templates up to date.
   */
  kind?: SectionKind;
  /**
   * Claude model tier override for this section's agent. When omitted,
   * KIND_POLICY.renderModel determines the model (Sonnet for narrative/
   * conclusion, Haiku for structural/default).
   */
  model?: "haiku" | "sonnet" | "opus";
  /**
   * Named post-render helpers applied after the optional critic pass.
   * Each name must be registered in sections/reconcilers/index.ts.
   * Examples: ["drug-normalizer"], ["icd-validator"], ["bp-sanity"].
   */
  reconcilers?: string[];
  /**
   * Enable the critic pass for this section. When true, a second Haiku
   * call audits the draft against the raw source (invention removal +
   * omission addition). Useful for narrative / clinical-judgment
   * sections (HPI/TO, Záver, OA). Skip on structural single-value
   * sections (Vitals, BMI, Výška) where a second pass just adds noise.
   * Defaults to false.
   */
  critic?: boolean;
}

export interface Template {
  id: string;
  name: Record<string, string>;
  description: Record<string, string>;
  sections: TemplateSection[];
  systemPrompt?: string;
  styleExamples?: { name: string; text: string }[];
  specialties?: string[];
  locales?: string[];
  isSystem?: boolean;
  sourceTemplateId?: string;
}
