/**
 * Generic section agent — the ONLY code path for note generation in the
 * new architecture.
 *
 * Renders ONE section of a clinical note. Takes raw source (transcript +
 * doctor notes + OCR files) + section config + already-rendered sections,
 * calls the configured Claude model with the section's `context` as the
 * clinical contract, then pipes the output through any named reconcilers.
 *
 * Clinical knowledge lives in two places only:
 *   1. The section's `context` string (editable per template / per admin).
 *   2. The named reconcilers in `./reconcilers` (small pure-TS helpers).
 *
 * No fact extraction, no EncounterModel, no deterministic section
 * renderers, no specialty pack. Each section reads raw source itself.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logUsage, type UsageContext } from "../usage";
import { RECONCILERS, type ReconcilerName } from "./reconcilers";

export type { UsageContext } from "../usage";

export interface RawSource {
  transcript?: string;
  doctorNotes?: string;
  /**
   * Files attached to the encounter. `context` is the doctor's optional
   * per-file instruction captured in the upload dialog ("focus on liver
   * markers, ignore old diagnosis") — surfaces to the LLM alongside the
   * file's text.
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
  /** Ordered names of reconcilers to apply after the LLM render. */
  reconcilers?: ReconcilerName[];
}

export interface RenderedSection {
  id: string;
  title: string;
  content: string;
}

export type Language = "sk" | "cs" | "en";

const MODEL_IDS: Record<SectionConfig["model"], string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ maxRetries: 4 });
  return _client;
}

const LANGUAGE_LABEL: Record<Language, string> = {
  sk: "Slovak",
  cs: "Czech",
  en: "English",
};

export async function renderSection(
  source: RawSource,
  section: SectionConfig,
  priorSections: RenderedSection[],
  language: Language = "sk",
  usage?: UsageContext,
  templateSystemPrompt?: string,
  sectionExamples?: string[],
): Promise<RenderedSection> {
  const systemPrompt = buildSystemPrompt(
    section,
    priorSections,
    language,
    templateSystemPrompt,
    sectionExamples,
  );
  const userMessage = buildUserMessage(source);

  const modelId = MODEL_IDS[section.model];
  const response = await client().messages.create({
    model: modelId,
    max_tokens: 2000,
    // temperature=0 for deterministic clinical documentation. Run-to-run
    // drift at default 1.0 is unacceptable when the same raw source should
    // produce the same note. Anthropic t=0 is still not byte-identical
    // across GPUs but it is as close as the API gets.
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  if (usage) {
    logUsage({
      userId: usage.userId,
      visitId: usage.visitId,
      provider: "anthropic",
      model: modelId,
      operation: "generate_section",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  let content = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  // Safety net for the "empty-return" rule. When the agent describes the
  // absence of content instead of returning literal empty — e.g. "(empty)",
  // "(No weight value found...)", "Žiadne údaje…", "V surových zdrojoch…" —
  // we strip it here so the rendered note doesn't ship with descriptive
  // placeholders. See `isAbsenceDescription` for the detection rules.
  if (isAbsenceDescription(content)) {
    content = "";
  }

  for (const name of section.reconcilers ?? []) {
    const reconciler = RECONCILERS[name];
    if (!reconciler) throw new Error(`Unknown reconciler: ${name}`);
    content = reconciler(content, source, { language });
  }

  return { id: section.id, title: section.title, content };
}

function buildSystemPrompt(
  section: SectionConfig,
  _priorSections: RenderedSection[],
  language: Language,
  templateSystemPrompt?: string,
  sectionExamples?: string[],
): string {
  const localeLabel = LANGUAGE_LABEL[language];

  const templateBlock = templateSystemPrompt?.trim()
    ? `\n\n# Template-wide guardrails (apply to every section in this template)\n${templateSystemPrompt.trim()}`
    : "";

  // Few-shot voice examples drawn from real attending notes attached to
  // this template. The LLM mimics the tone + structure — never the facts.
  // The corpus is the style bible; nothing else encodes the doctor's
  // phrasing preferences.
  const examplesBlock =
    sectionExamples && sectionExamples.length > 0
      ? `\n\n# Voice examples for "${section.title}" (senior-attending notes from this template's corpus)\nMimic the TONE and STRUCTURE of these examples. NEVER copy patient-specific facts, numbers, names, or dates from them — those belong to other patients. Use them only as style references for how this doctor writes this section.\n\n${sectionExamples
          .map((ex, i) => `Example ${i + 1}:\n${ex}`)
          .join("\n\n")}`
      : "";

  // Four-layer prompt stack:
  //
  //   1. ROLE + 3 universal rules — no specialty or section assumptions.
  //   2. Template-wide guardrails (worldview) — tone, abbreviations,
  //      unit conventions. Specialty-specific.
  //   3. Voice examples — few-shot snippets from real attending notes
  //      attached to this template. Show, don't tell.
  //   4. Section contract — OWNS / NEVER OWNS / FORMAT / LIMITS / WHEN
  //      EMPTY. Section-specific.
  return `# Role
You render ONE section of a structured medical note for a ${localeLabel}-speaking doctor. Your work is verbatim transformation of the source, not authorship. Accuracy matters — this is real clinical documentation.

# Core rules (absolute)
1. GROUND TRUTH. Every word must be traceable to the raw source below. No invention, no inference beyond what is written.
2. VERBATIM. Preserve drug names, doses (number + unit), frequency notation, clinical abbreviations, and numeric values exactly as stated.
3. STAY IN LANE. Include ONLY content that matches THIS section's contract below. Other sections will claim what doesn't belong. When nothing in the source matches the contract, output ZERO characters — no explanation of absence.${templateBlock}${examplesBlock}

# Your task
Render ONLY the "${section.title}" section. Output plain ${localeLabel} text — no heading, no preamble, no markdown, no meta-commentary.

# Section contract (binding)
${section.context}`;
}

function buildUserMessage(source: RawSource): string {
  const parts: string[] = [];
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
  return parts.join("\n\n");
}

/**
 * Catches the common ways Claude describes an absence of content instead
 * of actually being empty. Returns true when the ENTIRE output string is
 * one of these "describing emptiness" phrases, so the caller can swap it
 * for literal "".
 *
 * Intentionally strict: only flags responses that are short and match a
 * known absence pattern — so real content that happens to mention "N/A"
 * or parenthetical asides in the middle of a paragraph is never affected.
 */
export function isAbsenceDescription(text: string): boolean {
  // Strip leading/trailing HTML comments — Haiku sometimes prefixes the
  // response with "<!-- BMI Section -->" or similar before the absence prose.
  const t = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (t.length === 0) return true;
  // Raised cap: EA leaks have produced 400+ char "reasoning essays" about
  // why the section is empty — we still want those caught.
  if (t.length > 600) return false;

  // 1. Whole response wrapped in parentheses — "(empty)", "(No weight found)",
  //    "(prázdne - výška nie je uvedená)", etc.
  if (/^\([^()]*\)$/i.test(t)) {
    return /empty|no\s|not\s|nie\s|neuv|žiadn|žiadne|pr[aá]zdn|n\/a|—/i.test(t);
  }

  // 2. Bare absence tokens.
  if (/^(n\/a|none|—|-|žiadne|neuvedené|neuvedeno|not\s+stated)\.?$/i.test(t)) {
    return true;
  }

  // 3. "X nie je uvedená/dostupná/možné" — any short response where an
  //    absence clause appears (not at the start, e.g. prefixed by the
  //    section label: "Hmotnosť nie je v zdrojoch uvedená.")
  if (
    t.length < 250 &&
    /\bnie\s+(je|s[uú])\s+(v\s+zdroj|v\s+surov|v\s+dostupn|uved|dostupn|explicitne|k\s+dispoz|možn)/i.test(
      t,
    )
  ) {
    return true;
  }

  // 4. Short responses with a clear absence opener / signal phrase.
  const patterns = [
    /^v\s+(surov|dostupn|zdrojov|poskytnut|raw\s+source)/i,
    /^v\s+zdroj/i,
    /^ziadn[eyo]\s+[uú]daj/i,
    /^žiadne?\s+[uú]daj/i,
    /^žiadne?\s+informáci/i,
    // "Žiadna hmotnosť uvedená…", "Žiadny údaj o výške…", "Žiadna v zdroji…"
    /^žiadn[aey]\s+\p{L}+\s+(?:\p{L}+\s+)?(uveden|nie|dostup|v\s+zdroj|v\s+surov|explicit)/iu,
    /^nie\s+(je|s[uú])\s+(uved|dostupn|explicitne|k\s+dispoz|možn)/i,
    /^nebola\s+uved/i,
    /^neuvedené/i,
    /^bez\s+(v[ýy]šky|hmotnosti|[úu]dajov|informáci)/i,
    /^pod[ľl]a\s+pravidiel/i,
    /^zbahňme/i,
    /^no\s+(data|information|weight|height|value|specific|mention)/i,
    /^not\s+(stated|available|specified|provided|mentioned|explicitly|documented)/i,
    /^there\s+(is|are)\s+no\s+/i,
    /^source\s+does\s+not/i,
    /^the\s+(source|raw\s+source)\s+(does\s+not|doesn['']?t)/i,
    /^bmi\s+nie\s+je\s+možn/i,
    // Agents sometimes quote the rule back at us before complying:
    /vrátim\s+pr[aá]zdn/i,
    /return\s+(?:an?\s+)?empty\s+string/i,
    /respond\s+with\s+(?:an?\s+)?empty/i,
  ];
  return patterns.some((re) => re.test(t));
}
