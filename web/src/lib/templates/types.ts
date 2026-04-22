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
