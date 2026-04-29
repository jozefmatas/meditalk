/**
 * Generic section agent — renders ONE section of a clinical note.
 *
 * Reads the raw source (transcript + doctor notes + OCR files) and
 * produces the section text per the admin-editable `section.context`
 * contract. Free-text output, streamed straight into the note — prose
 * style, abbreviations, and compact formatting come through verbatim.
 *
 * Grounding is enforced downstream: the critic tool-use pass strips
 * invention, and the reconcilers (drug-normalizer, icd-validator)
 * canonicalise drugs + ICD codes. `isAbsenceDescription` below catches
 * the common "(empty — …)" / essay-describing-absence leaks so they
 * don't ship as placeholder text.
 */
import { resolve, type SystemBlock } from "../models";
import { logUsage, type UsageContext } from "../usage";
import type { NoteSkeleton } from "./note-skeleton";
import { formatSkeletonBlock } from "./note-skeleton";

export type { UsageContext } from "../usage";

export interface RawSource {
  transcript?: string;
  doctorNotes?: string;
  /**
   * Files attached to the encounter. `context` is the doctor's optional
   * per-file instruction captured in the upload dialog ("focus on liver
   * markers, ignore old diagnosis") — surfaces to the LLM alongside the
   * file's text. When present, the pipeline has already filtered the
   * file via the file-focus extractor before the agent sees it.
   */
  files?: Array<{ name: string; text: string; context?: string }>;
}

export interface SectionConfig {
  /** Stable id — "la", "to", "zaver", … */
  id: string;
  /** Display title rendered in the final note ("LA", "TO", "Záver"). */
  title: string;
  /** Clinical contract. Admin-editable, specialty-aware. */
  context: string;
  /** Model tier for this section. */
  model: "haiku" | "sonnet" | "opus";
  /**
   * Declarative classification of the section (from TemplateSection.kind,
   * resolved with the legacy label-match fallback in pipeline.ts). The
   * pipeline dispatches behavior — voice-example suppression,
   * digit-grounding, critic model tier — off this single field.
   */
  kind?: import("../templates/types").SectionKind;
  /**
   * Ordered names of reconcilers to apply after the optional critic pass.
   * See `./reconcilers/index.ts`. Examples: `["drug-normalizer"]`,
   * `["icd-validator"]`.
   */
  reconcilers?: string[];
  /**
   * When true, a second Haiku call audits this section's draft against
   * the source before reconcilers run. Enable on narrative / clinical-
   * judgment sections.
   */
  critic?: boolean;
}

export interface RenderedSection {
  id: string;
  title: string;
  content: string;
  /**
   * The author's pre-critic draft. Populated only when the critic pass
   * actually modified the content — gives us a diff record for
   * debugging and eval-set construction.
   */
  draft?: string;
}

export type Language = "sk" | "cs" | "en";

const LANGUAGE_LABEL: Record<Language, string> = {
  sk: "Slovak",
  cs: "Czech",
  en: "English",
};

export async function renderSection(
  source: RawSource,
  section: SectionConfig,
  language: Language = "sk",
  usage?: UsageContext,
  templateSystemPrompt?: string,
  sectionExamples?: string[],
  skeleton?: NoteSkeleton | null,
  /** Extra context appended to the user message (e.g. ICD suggestions
   *  for the conclusion section). Not part of the system prompt. */
  additionalContext?: string,
): Promise<RenderedSection> {
  const systemBlocks = buildSystemBlocks(
    section,
    language,
    templateSystemPrompt,
    sectionExamples,
  );
  const userMessage = buildUserMessage(
    source,
    skeleton ?? null,
    additionalContext,
  );
  const provider = resolve("section-agent", section.model);

  // temperature=0 for deterministic clinical documentation. Run-to-run
  // drift at default 1.0 is unacceptable when the same raw source should
  // produce the same note.
  const result = await provider.generate({
    maxTokens: 2000,
    temperature: 0,
    system: systemBlocks,
    user: userMessage,
  });

  if (usage) {
    logUsage({
      userId: usage.userId,
      visitId: usage.visitId,
      provider: provider.name,
      model: provider.model,
      operation: "generate_section",
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheCreationInputTokens: result.usage.cacheCreationTokens,
      cacheReadInputTokens: result.usage.cacheReadTokens,
    });
  }

  let content = (result.text ?? "").trim();

  if (isAbsenceDescription(content)) {
    content = "";
  }

  return { id: section.id, title: section.title, content };
}

// ─── Absence-description safety net ──────────────────────────────────

/**
 * Catches the common ways Claude describes an absence of content instead
 * of actually being empty. Returns true when the ENTIRE output string is
 * one of these "describing emptiness" phrases, so the caller can swap it
 * for literal "".
 *
 * Intentionally strict: only flags responses that are short AND match a
 * known absence pattern — real content that happens to mention "N/A"
 * or parenthetical asides in the middle of a paragraph is never affected.
 */
export function isAbsenceDescription(text: string): boolean {
  // Strip leading/trailing HTML comments — Haiku sometimes prefixes the
  // response with "<!-- BMI Section -->" or similar before absence prose.
  const t = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (t.length === 0) return true;

  const firstLine = (t.split("\n")[0] ?? "").trim();
  const head = t.slice(0, 200);

  if (/^\(?\s*(empty|zero\s+characters?)\b/i.test(firstLine)) return true;
  if (/^zero\s+characters?$/i.test(firstLine)) return true;
  if (/^\([^()]*\bempty\b[^()]*\bzero\b[^()]*\)/i.test(firstLine)) return true;

  if (
    /^(the\s+current\s+output|per\s+the\s+section\s+contract|the\s+phrase\s+["']|after\s+review,?\s+the)/i.test(
      head,
    )
  ) {
    return true;
  }

  if (
    /^(the\s+draft\s+(contains|does\s+not)|the\s+section\s+contract|the\s+raw\s+source\s+(contains\s+no|does\s+not)|the\s+image\s+file\s+shows|since\s+no\s+\w+\s+(exist|findings|content|reading|data)|no\s+\w+\s+(exist|findings|content|reading)\s+in\s+the\s+source|based\s+on\s+the\s+(source|contract|instructions))/i.test(
      head,
    )
  ) {
    return true;
  }

  // Raised cap: leaks have produced 400+ char "reasoning essays" about
  // why the section is empty. 1500 covers the multi-paragraph essays.
  if (t.length > 1500) return false;

  if (/^\([^()]*\)$/i.test(t)) {
    return /empty|no\s|not\s|nie\s|neuv|žiadn|žiadne|pr[aá]zdn|n\/a|—/i.test(t);
  }

  if (/^(n\/a|none|—|-|žiadne|neuvedené|neuvedeno|not\s+stated)\.?$/i.test(t)) {
    return true;
  }

  if (
    t.length < 250 &&
    /\bnie\s+(je|s[uú])\s+(v\s+zdroj|v\s+surov|v\s+dostupn|uved|dostupn|explicitne|k\s+dispoz|možn)/i.test(
      t,
    )
  ) {
    return true;
  }

  if (
    t.length < 250 &&
    /\bnenach[áa]dza\b[^.]*\b(v\s+)?(zdroj|surov|poskytnut|dostupn|materi[aá]l)/i.test(
      t,
    )
  ) {
    return true;
  }

  const patterns = [
    /^v\s+(surov|dostupn|zdrojov|poskytnut|raw\s+source)/i,
    /^v\s+zdroj/i,
    /^ziadn[eyo]\s+[uú]daj/i,
    /^žiadne?\s+[uú]daj/i,
    /^žiadne?\s+informáci/i,
    /^žiadn[aey]\s+\p{L}+\s+(?:\p{L}+\s+)?(uveden|nie|dostup|v\s+zdroj|v\s+surov|explicit)/iu,
    /^nie\s+(je|s[uú])\s+(uved|dostupn|explicitne|k\s+dispoz|možn)/i,
    /^nebola\s+uved/i,
    /^neuvedené/i,
    /^bez\s+(v[ýy]šky|hmotnosti|[úu]dajov|informáci)/i,
    /^pod[ľl]a\s+pravidiel/i,
    /^no\s+(data|information|weight|height|value|specific|mention)/i,
    /^not\s+(stated|available|specified|provided|mentioned|explicitly|documented)/i,
    /^there\s+(is|are)\s+no\s+/i,
    /^source\s+does\s+not/i,
    /^the\s+(source|raw\s+source)\s+(does\s+not|doesn['']?t)/i,
    /^bmi\s+nie\s+je\s+možn/i,
    /vrátim\s+pr[aá]zdn/i,
    /return\s+(?:an?\s+)?empty\s+string/i,
    /respond\s+with\s+(?:an?\s+)?empty/i,
  ];
  return patterns.some((re) => re.test(t));
}

// ─── Prompt assembly ─────────────────────────────────────────────────

/**
 * Build the section-agent's system prompt as an array of blocks with
 * explicit prompt-cache breakpoints. Layout:
 *
 *   block 1 — ROLE + CORE_RULES         (cache: true)
 *     Varies only by language. ~3 possible cache entries globally.
 *
 *   block 2 — TEMPLATE GUARDRAILS       (cache: true)
 *     Only added when the template has a non-empty systemPrompt. One
 *     cache entry per unique template.systemPrompt.
 *
 *   block 3 — PER-SECTION (EXAMPLES + TASK + CONTRACT)  (uncached)
 *     Voice examples differ per section, so this block is not worth
 *     caching.
 *
 * Each subsequent call within the 5-minute cache TTL that uses the same
 * language + same template re-uses blocks 1 and 2, paying the
 * cache-read rate (0.1× input) instead of full rate.
 */
export function buildSystemBlocks(
  section: SectionConfig,
  language: Language,
  templateSystemPrompt?: string,
  sectionExamples?: string[],
): SystemBlock[] {
  const localeLabel = LANGUAGE_LABEL[language];
  const blocks: SystemBlock[] = [];

  // ── block 1: ROLE + CORE RULES (cached) ──
  blocks.push({
    text: `# Role
You render ONE section of a structured medical note for a ${localeLabel}-speaking doctor. Your work is verbatim transformation of the source, not authorship. Accuracy matters — this is real clinical documentation. A separate critic pass will double-check your output against the source; focus on faithful transformation, not defensive omission.

# Core rules (absolute)
1. GROUND TRUTH. Every word must be traceable to the raw source below. No invention, no inference beyond what is written.
2. VERBATIM. Preserve drug names, doses (number + unit), frequency notation, clinical abbreviations, and numeric values exactly as stated.
3. STAY IN LANE. Include ONLY content that matches THIS section's contract below. Other sections will claim what doesn't belong. When nothing in the source matches the contract, output ZERO characters — no explanation of absence.`,
    cache: true,
  });

  // ── block 2: TEMPLATE GUARDRAILS (cached; only when present) ──
  const templateGuardrails = templateSystemPrompt?.trim();
  if (templateGuardrails) {
    blocks.push({
      text: `# Template-wide guardrails (apply to every section in this template)\n${templateGuardrails}`,
      cache: true,
    });
  }

  // ── block 3: PER-SECTION (uncached) ──
  const examplesText =
    sectionExamples && sectionExamples.length > 0
      ? `# Voice examples for "${section.title}" (senior-attending notes from this template's corpus)\nMimic the TONE and STRUCTURE of these examples. NEVER copy patient-specific facts, numbers, names, or dates from them — those belong to other patients. Use them only as style references for how this doctor writes this section.\n\n${sectionExamples
          .map((ex, i) => `Example ${i + 1}:\n${ex}`)
          .join("\n\n")}\n\n`
      : "";

  blocks.push({
    text: `${examplesText}# Your task
Render ONLY the "${section.title}" section. Output plain ${localeLabel} text — no heading, no preamble, no markdown, no meta-commentary. Follow the contract's format rules for this section (compact single paragraph vs. line-per-item vs. narrative prose).

# Section contract (binding)
${section.context}`,
  });

  return blocks;
}

function buildUserMessage(
  source: RawSource,
  skeleton: NoteSkeleton | null,
  additionalContext?: string,
): string {
  const parts: string[] = [];

  // Shared encounter context (pre-computed skeleton). Placed BEFORE the
  // raw source so the renderer treats it as a high-level hint. The
  // framing below tells the model that source is still the truth when
  // the two disagree.
  if (skeleton) {
    parts.push(
      `# Shared encounter context (pre-computed hint — source is TRUTH when they conflict)\n${formatSkeletonBlock(skeleton)}`,
    );
  }

  if (source.transcript?.trim()) {
    parts.push(`# Transcript\n${source.transcript.trim()}`);
  }
  if (source.doctorNotes?.trim()) {
    parts.push(`# Doctor notes\n${source.doctorNotes.trim()}`);
  }
  for (const file of source.files ?? []) {
    if (!file.text.trim()) continue;
    const ctx = file.context?.trim();
    const header = ctx
      ? `# File: ${file.name}\nDoctor's focus for this file: ${ctx}`
      : `# File: ${file.name}`;
    parts.push(`${header}\n${file.text.trim()}`);
  }

  // Additional context (e.g. ICD suggestions for conclusion). Appended
  // after source so the model sees it alongside but separate from raw data.
  if (additionalContext?.trim()) {
    parts.push(additionalContext.trim());
  }

  return parts.join("\n\n");
}
