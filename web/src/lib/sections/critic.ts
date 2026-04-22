/**
 * Critic pass — Stage 2 of the per-section pipeline, opt-in.
 *
 * For sections where invention/omission bite hardest (HPI/TO, Záver,
 * OA), a second Haiku call audits the draft against the raw source:
 *
 *   1. Remove any claim in the draft that isn't in the source.
 *   2. Add any source fact that belongs in this section but is missing.
 *   3. Preserve the draft's voice / ordering / format — correct, don't
 *      rewrite. If the draft is already faithful and complete, return
 *      it unchanged.
 *
 * One prompt template, parameterised per section. Symmetric input with
 * the author pass (same source, same section.context), plus the
 * author's draft. Haiku, temperature 0. No JSON — returns corrected
 * text directly.
 *
 * Opt-in via `section.critic = true` on the template — structural
 * sections (Vitals, BMI, Výška) don't need it and the extra call just
 * adds noise on single-value extractions.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logUsage, type UsageContext } from "../usage";
import type { Language, RawSource } from "./section-agent";

const MODEL_ID = "claude-haiku-4-5-20251001";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ maxRetries: 2 });
  return _client;
}

const LANGUAGE_LABEL: Record<Language, string> = {
  sk: "Slovak",
  cs: "Czech",
  en: "English",
};

export interface CriticInput {
  /** The author's draft — what renderSection produced (or, for Záver,
   *  the suggester's formatted output). */
  draft: string;
  source: RawSource;
  sectionId: string;
  sectionTitle: string;
  sectionContext: string;
  language: Language;
  usage?: UsageContext;
}

export interface CriticResult {
  /** Corrected content. Identical to input when nothing needed changing. */
  content: string;
  changed: boolean;
  /** One-line human-readable summary for logs. */
  diffSummary: string;
}

export async function criticPass(input: CriticInput): Promise<CriticResult> {
  const draft = input.draft.trim();
  if (draft.length === 0) {
    return { content: input.draft, changed: false, diffSummary: "empty" };
  }

  const systemPrompt = buildSystemPrompt(input);
  const userMessage = buildUserMessage(input, draft);

  const response = await client().messages.create({
    model: MODEL_ID,
    max_tokens: 2000,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  if (input.usage) {
    logUsage({
      userId: input.usage.userId,
      visitId: input.usage.visitId,
      provider: "anthropic",
      model: MODEL_ID,
      operation: "generate_section",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  const corrected = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  const changed = corrected !== draft;
  const diffSummary = changed
    ? `len ${draft.length}→${corrected.length}`
    : "no change";
  return { content: corrected, changed, diffSummary };
}

// ─── Prompt assembly ──────────────────────────────────────────────────

function buildSystemPrompt(input: CriticInput): string {
  const localeLabel = LANGUAGE_LABEL[input.language];

  return `# Role
You audit a draft "${input.sectionTitle}" section of a ${localeLabel} clinical note against the raw source. You RETURN the corrected section text — not a diff, not commentary.

# Check exactly two things
1. INVENTION — any fact, number, name, drug, diagnosis, or wording in the draft that is NOT found in the raw source. Remove it.
2. OMISSION — any fact in the source that belongs in this section (per the contract below) but is missing from the draft. Add it, formatted consistently with the draft's existing style.

# Preserve the draft
Keep the author's voice, ordering, format, and connective tissue ("pred dvoma dňami", "včera", "preto", "následne", "bez ďalších ťažkostí"). These are not facts but they are not invention either — keep them.
Keep negations and differential phrasing ("neguje", "bez edémov", "nemožno vylúčiť …") exactly as the author wrote them.
Correct; do NOT rewrite for aesthetic reasons.

# If already correct
If the draft is already faithful to the source and complete per the contract, return it UNCHANGED, byte-for-byte.

# Output
Plain ${localeLabel} text. NO preamble, NO explanation, NO markdown, NO heading. Only the corrected section text. If the section should be empty (no source content matches the contract), return an empty string — no placeholder, no explanation.

# Section contract (what THIS section OWNS and EXCLUDES)
${input.sectionContext}`;
}

function buildUserMessage(input: CriticInput, draft: string): string {
  const parts: string[] = [];

  const sourceBlock = buildSourceBlock(input.source);
  if (sourceBlock) parts.push(sourceBlock);

  parts.push(`# Current "${input.sectionTitle}" draft\n${draft}`);

  return parts.join("\n\n");
}

function buildSourceBlock(source: RawSource): string {
  const parts: string[] = [];
  if (source.transcript?.trim()) {
    parts.push(`## Transcript\n${source.transcript.trim()}`);
  }
  if (source.doctorNotes?.trim()) {
    parts.push(`## Doctor notes\n${source.doctorNotes.trim()}`);
  }
  for (const file of source.files ?? []) {
    if (!file.text?.trim()) continue;
    parts.push(`## File: ${file.name}\n${file.text.trim()}`);
  }
  if (parts.length === 0) return "";
  return `# Raw source\n\n${parts.join("\n\n")}`;
}
