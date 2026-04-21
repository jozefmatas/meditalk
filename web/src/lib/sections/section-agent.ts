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
): Promise<RenderedSection> {
  const systemPrompt = buildSystemPrompt(section, priorSections, language);
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

  for (const name of section.reconcilers ?? []) {
    const reconciler = RECONCILERS[name];
    if (!reconciler) throw new Error(`Unknown reconciler: ${name}`);
    content = reconciler(content, source);
  }

  return { id: section.id, title: section.title, content };
}

function buildSystemPrompt(
  section: SectionConfig,
  priorSections: RenderedSection[],
  language: Language,
): string {
  const localeLabel = LANGUAGE_LABEL[language];
  const prior =
    priorSections.length > 0
      ? priorSections.map((s) => `### ${s.title}\n${s.content}`).join("\n\n")
      : "(no prior sections yet)";

  return `You are rendering the "${section.title}" section of a clinical note.

Language: ${localeLabel}.
Output: plain ${localeLabel} text for this section ONLY — no headings, no preamble, no markdown, no explanations.

# Section contract
${section.context}

# Already-rendered sections (do NOT duplicate their content)
${prior}

Rules:
- Include only content that fits THIS section's contract above.
- Do not duplicate anything already present in the already-rendered sections.
- Use ONLY facts present in the raw source below. No invention, no inference beyond what's written.
- Preserve the doctor's wording, dose/frequency notation, abbreviations, and numeric values verbatim.
- If nothing in the raw source fits this section, return an empty string.`;
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
