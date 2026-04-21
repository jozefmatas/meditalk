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
1. Ground truth only. Every word must be traceable to the raw source below. No inference, no filling gaps, no "clinical best guess".
2. Never fuse distinct diagnoses. A heart attack and a stroke are two separate events — write them as separate facts, or quote the speaker's exact words. Never concatenate two distinct diagnoses into a compound term that does not exist in medicine (e.g. "infarkt mozgovej mŕtvice" is forbidden).
3. Preserve exactly: drug names, doses (number + unit), frequency notation ("1-0-1", "ráno a večer", "podľa potreby"), abbreviations (st.p., MGUS, AV blok, NSTEMI), numeric values (BP, HR, lab results, timestamps), and the speaker's clinical wording in general.
4. When the source is ambiguous or a term is unclear, quote the speaker's actual words rather than paraphrasing or guessing.
5. Section discipline. Each section has ONE job, defined by its contract below. Other sections in the template will claim anything that doesn't belong to you — NEVER stuff miscellaneous facts into your section just because it would otherwise be empty.
6. Empty is the correct answer when nothing in the source fits your contract. Output ZERO characters — not "(empty)", not "(empty string)", not "N/A", not "—", not "neuvedené", not "nie je uvedené", not "žiadne údaje", not "V surových zdrojoch...", not any description of the absence. Silence is expected and correct here.${templateBlock}

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
  const t = text.trim();
  if (t.length === 0) return true;
  if (t.length > 300) return false;

  // 1. Whole response wrapped in parentheses — "(empty)", "(No weight found)",
  //    "(prázdne - výška nie je uvedená)", etc.
  if (/^\([^()]*\)$/i.test(t)) {
    return /empty|no\s|not\s|nie\s|neuv|žiadn|žiadne|pr[aá]zdn|n\/a|—/i.test(t);
  }

  // 2. Bare absence tokens.
  if (/^(n\/a|none|—|-|žiadne|neuvedené|neuvedeno|not\s+stated)\.?$/i.test(t)) {
    return true;
  }

  // 3. Short responses that OPEN with a known absence phrase and don't
  //    contain any clinical content. 300-char cap above keeps us honest.
  const openers = [
    /^v\s+(surov|dostupn|zdrojov|poskytnut)/i,
    /^v\s+zdroj/i,
    /^ziadn[eyo]\s+[uú]daj/i,
    /^ziadne\s+[uú]daje/i,
    /^žiadne\s+[uú]daje/i,
    /^žiadne\s+informáci/i,
    /^nie\s+(je|s[uú])\s+(uved|dostupn|explicitne|k\s+dispoz)/i,
    /^nebola\s+uved/i,
    /^neuvedené/i,
    /^no\s+(data|information|weight|height|value|specific)/i,
    /^not\s+(stated|available|specified|provided|mentioned|explicitly|documented)/i,
    /^there\s+(is|are)\s+no\s+/i,
    /^source\s+does\s+not/i,
    /^the\s+(source|raw\s+source)\s+(does\s+not|doesn['']?t)/i,
    /^bmi\s+nie\s+je\s+možn/i,
    /^nie\s+je\s+možn/i,
  ];
  return openers.some((re) => re.test(t));
}
