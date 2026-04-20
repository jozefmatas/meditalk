/**
 * Narrative renderer — the single LLM-backed renderer in the pipeline.
 *
 * Handles `chiefComplaint` (TO / HPI) and `plan` sections. Consumes
 * only the narrative slots of the `EncounterModel`:
 *
 *   - TO: `model.currentEncounter.hpiFacts`
 *   - Plan: `model.currentEncounter.planItems`
 *
 * The model has already committed which facts belong in which slot;
 * this renderer only formats them as flowing prose. It may NOT pull
 * from `doctorNotes` / `fileTexts` / objective slots / history slots —
 * that was the old TO "HPI from everywhere" contamination vector.
 *
 * `extractNarrativeEvidence` can supplement the Opus prompt with short
 * fact-scoped source snippets for language texture (onset phrases,
 * refusal wording, etc.) — but those are optional flavoring, not
 * content. Opus's instruction is to reorder facts grammatically,
 * nothing else.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupportedLanguage } from "../../types";
import { logger } from "@/lib/logger";
import type { EncounterModel, FactRef } from "../encounter-model";
import {
  extractNarrativeEvidence,
  formatNarrativeEvidence,
  type NarrativeSources,
} from "../narrative-evidence";
import { extractJson } from "../json-repair";
import { extractSectionsFromStream } from "../../api/sse";
import { logUsage, type UsageContext } from "../../usage";

const OPUS_MODEL = "claude-opus-4-6";

const LANG: Record<SupportedLanguage, string> = {
  sk: "Slovak",
  cs: "Czech",
  en: "English",
};

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ maxRetries: 4 });
  return _anthropic;
}

export interface NarrativeTargetSection {
  id: string;
  label: string;
  role: "chiefComplaint" | "plan";
}

function buildSystemPrompt(language: SupportedLanguage): string {
  const lang = LANG[language];
  return `You are a clinical narrative formatter writing in ${lang}.

INPUT: A JSON object with one entry per section. Each entry lists
pre-assigned clinical facts, each marked as AFFIRMED or NEGATED, plus
optional NARRATIVE EVIDENCE — short source snippets you may consult
for tone/phrasing only.

OUTPUT: A JSON object with the same section IDs as keys and flowing
${lang} prose as values. No bullets, no ICD codes, no section headings
inside values, no Markdown. If a section has no facts, output "".

RULES:
1. Do NOT add clinical facts that aren't in the provided list. No
   diseases from general knowledge, no seasonal / chronicity context
   unless an explicit fact says so.
2. Reorder for chronological / grammatical flow, but preserve each
   fact's meaning. Negated facts must render as proper ${lang}
   negations ("bez ...", "neguje ...", "no ...", "denies ...").
3. Do NOT list medications, diagnoses, labs, vitals, allergies, past
   history, or family history — those sections render separately.
4. The NARRATIVE EVIDENCE snippets are FOR TONE ONLY. Do not quote
   them verbatim or extract new clinical content from them.
5. Return valid JSON. No prose, no Markdown, no comments.`;
}

function formatFactForPrompt(f: FactRef): string {
  return `${f.negated ? "[NEGATED]" : "[AFFIRMED]"} ${f.value}`;
}

function buildUserMessage(
  sections: NarrativeTargetSection[],
  model: EncounterModel,
  narrativeEvidence: string,
): string {
  const lines: string[] = [];
  if (model.visitDate) {
    lines.push(`ENCOUNTER DATE: ${model.visitDate}`);
    lines.push(
      'Resolve "dnes"/"včera"/"today"/"yesterday" relative to this date.',
    );
    lines.push("");
  }

  for (const section of sections) {
    lines.push(`[Section "${section.label}" (${section.id})]:`);
    const facts =
      section.role === "chiefComplaint"
        ? model.currentEncounter.hpiFacts
        : model.currentEncounter.planItems;
    if (facts.length === 0) {
      lines.push("  (no facts assigned)");
    } else {
      for (const f of facts) lines.push(`  - ${formatFactForPrompt(f)}`);
    }
    lines.push("");
  }

  if (narrativeEvidence.trim().length > 0) {
    lines.push(narrativeEvidence);
    lines.push("");
  }

  lines.push(
    `Return valid JSON with keys: ${sections.map((s) => `"${s.id}"`).join(", ")}`,
  );
  return lines.join("\n");
}

export interface NarrativeRenderResult {
  contents: Record<string, string>;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Render the narrative sections (TO + Plan) from the model via Opus.
 *
 * `sources` is only used to produce NARRATIVE EVIDENCE snippets — if
 * undefined, Opus gets facts only. When provided, `extractNarrativeEvidence`
 * pulls a small ±120-char window around each HPI/plan fact's evidence
 * quote from the original source, capped at 3000 chars total.
 */
export async function renderNarrativeFromModel(
  model: EncounterModel,
  sections: NarrativeTargetSection[],
  options: {
    sources?: NarrativeSources;
    onSection?: (id: string, title: string, content: string) => void;
    ctx?: UsageContext;
  } = {},
): Promise<NarrativeRenderResult> {
  if (sections.length === 0) {
    return { contents: {}, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  const narrativeEvidence = options.sources
    ? (() => {
        const relevantFacts = [
          ...model.currentEncounter.hpiFacts,
          ...model.currentEncounter.planItems,
        ];
        // The evidence extractor wants the underlying ExtractedFact shape;
        // FactRef is a superset of the fields it needs (source + value).
        const asExtracted = relevantFacts.map((r) => ({
          category: r.category,
          value: r.value,
          source: r.source,
        }));
        const snippets = extractNarrativeEvidence(
          asExtracted,
          options.sources!,
        );
        return formatNarrativeEvidence(snippets);
      })()
    : "";

  const systemPrompt = buildSystemPrompt(model.language);
  const userMessage = buildUserMessage(sections, model, narrativeEvidence);

  const sectionIdSet = new Set(sections.map((s) => s.id));
  const sectionLabels: Record<string, string> = {};
  for (const s of sections) sectionLabels[s.id] = s.label;
  const emitted = new Set<string>();
  let accumulated = "";

  const stream = anthropic().messages.stream({
    model: OPUS_MODEL,
    max_tokens: 4096,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  stream.on("text", (delta) => {
    accumulated += delta;
    if (options.onSection) {
      extractSectionsFromStream(
        accumulated,
        sectionIdSet,
        emitted,
        sectionLabels,
        options.onSection,
      );
    }
  });

  const started = Date.now();
  const finalMessage = await stream.finalMessage();
  const elapsed = Date.now() - started;
  logger.debug(
    `[narrative-renderer] ${elapsed}ms in=${finalMessage.usage.input_tokens} out=${finalMessage.usage.output_tokens}`,
  );

  if (options.ctx) {
    logUsage({
      userId: options.ctx.userId,
      visitId: options.ctx.visitId,
      provider: "anthropic",
      model: OPUS_MODEL,
      operation: "generate_template",
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    });
  }

  const text =
    finalMessage.content[0].type === "text" ? finalMessage.content[0].text : "";
  const parsed = extractJson<Record<string, string>>(text);
  const contents: Record<string, string> = {};
  for (const s of sections) {
    const v = parsed[s.id];
    contents[s.id] = typeof v === "string" ? v : "";
  }
  return {
    contents,
    usage: {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    },
  };
}
