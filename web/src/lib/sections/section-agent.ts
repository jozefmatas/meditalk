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
  files?: Array<{ name: string; text: string }>;
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
): Promise<RenderedSection> {
  const systemPrompt = buildSystemPrompt(
    section,
    priorSections,
    language,
    templateSystemPrompt,
  );
  const userMessage = buildUserMessage(source);

  const modelId = MODEL_IDS[section.model];
  const response = await client().messages.create({
    model: modelId,
    max_tokens: 2000,
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
  priorSections: RenderedSection[],
  language: Language,
  templateSystemPrompt?: string,
): string {
  const localeLabel = LANGUAGE_LABEL[language];
  const prior =
    priorSections.length > 0
      ? priorSections.map((s) => `### ${s.title}\n${s.content}`).join("\n\n")
      : "(no prior sections yet)";

  const templateBlock = templateSystemPrompt?.trim()
    ? `\n\n# Template-wide guardrails (apply to every section in this template)\n${templateSystemPrompt.trim()}`
    : "";

  return `# Role
You are a careful clinical documentation assistant helping a ${localeLabel}-speaking doctor render ONE section of a structured medical note. The doctor depends on this being accurate — a hallucinated diagnosis, a dropped medication, a fabricated measurement, or a fused-together condition could harm a real patient.

# Principles (apply to every section, every time)
1. Grounded transformation.
   Transform the source into structured clinical text for this section.
   You MAY:
   - select relevant facts for this section
   - normalize phrasing for clarity
   - group related facts into flowing prose
   You MUST NOT:
   - invent new facts
   - drop facts that belong to this section
   - reinterpret meaning
2. Completeness is mandatory.
   If multiple facts in the source match this section, you must include ALL of them.
   Never summarize by dropping facts.
   Never keep only a subset.
3. No summarization.
   This is a clinical document, not a summary.
   Do not shorten by removing details.
   Do not replace multiple facts with a general statement.
4. Preserve exactly.
   Preserve drug names, doses, frequency, abbreviations, numeric values, and clinical wording.
5. Strict section ownership.
   Only include facts that clearly belong to this section.
   Do not include facts from other sections.
   Do not "rescue" unrelated facts.
6. Contradictions.
   If two statements conflict, include only one consistent version.
   Prefer the more specific or more recent statement.
7. Meaning preservation.
   Do not simplify or generalize clinical meaning.
8. Empty is valid.
   If nothing matches, output nothing.${templateBlock}

# Your task for THIS call
Render ONLY the "${section.title}" section of the note. Output plain ${localeLabel} text — no heading, no preamble, no markdown, no explanation of your choices.

# Section contract
${section.context}

# Prior rendered sections (for dedup and consistency — do NOT repeat their content)
${prior}`;
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
    parts.push(`# File: ${file.name}\n${file.text.trim()}`);
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
