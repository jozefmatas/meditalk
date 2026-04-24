/**
 * Declarative classification of what a section holds. Replaces the
 * hardcoded label-matching sets the pipeline used to carry (ZAVER_LABELS,
 * STRUCTURAL_VITAL_LABELS, EXAM_NARRATIVE_LABELS, LA_LABELS).
 *
 * The `kind` drives per-section behaviour — voice-example suppression,
 * digit-grounding on vitals, the Haiku-vs-Sonnet critic choice, skipping
 * Záver in the render loop. Admin can author new section types without
 * any code change.
 *
 * Values:
 *   - "default"            — narrative prose (RA, SA, PA, EA, Ab, …).
 *   - "history-narrative"  — TO-style HPI synthesis.
 *   - "vital-numeric"      — single-value vitals (Výška/Hmotnosť/BMI/TK/
 *                            Pulz/EKG); digit-grounded, voice examples off.
 *   - "exam-narrative"     — Celkové vyšetrenie / Fyzikálne vyšetrenie;
 *                            voice examples off to prevent boilerplate leak.
 *   - "medication-list"    — LA; Haiku critic (completeness over
 *                            strictness), drug-normalizer reconciler.
 *   - "conclusion"         — Záver; skipped in the generate loop, populated
 *                            from the ICD suggester in the route.
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
   * Claude model tier for this section's agent.
   * Defaults to "haiku" when not set. Switch to "sonnet" / "opus" only
   * for sections that demonstrably need it (narrative TO, nuanced Záver).
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
