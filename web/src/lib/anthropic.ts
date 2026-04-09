import Anthropic from "@anthropic-ai/sdk";
import type { SupportedLanguage } from "./types";
import type { Template } from "./templates/types";
import { buildTemplateHtml, flattenSectionIds } from "./templates/html";
import { logUsage, type UsageContext } from "./usage";
import { buildEnrichedSystemPrompt } from "./clinical/pipeline";
import { extractJson } from "./clinical/json-repair";
import {
  validateIcdDescriptions,
  extractIcdCodesFromSections,
  resolveIcdCodes,
} from "./clinical/icd-index";
import { extractSectionsFromStream } from "./api/sse";
import type { CandidateIcdCode, ClinicalAnalysis } from "./clinical/types";
import type { ExtractedFacts } from "./clinical/fact-extraction";
import { countFacts, formatFactsForPrompt } from "./clinical/fact-validator";
import { logger } from "@/lib/logger";

export class InsufficientContextError extends Error {
  constructor() {
    super("insufficient_context");
    this.name = "InsufficientContextError";
  }
}

let _anthropic: Anthropic | null = null;
export function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ maxRetries: 4 });
  return _anthropic;
}

export const NOT_STATED: Record<SupportedLanguage, string> = {
  en: "Not stated",
  sk: "Neuvedené",
  cs: "Neuvedeno",
};

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "English",
  sk: "Slovak",
  cs: "Czech",
};

/**
 * Build a system prompt for template-based generation.
 */
export function buildTemplateSystemPrompt(
  template: Template,
  language: SupportedLanguage,
  sectionLabels: Record<string, string>,
  sectionContexts?: Record<string, string>,
): string {
  const langLabel = LANGUAGE_LABELS[language];
  const allIds = flattenSectionIds(template);

  const sectionList = allIds
    .map((id) => {
      const label = sectionLabels[id] || id;
      const context = sectionContexts?.[id];
      // If section has specific guidance, include it prominently
      if (context) {
        return `- "${id}": ${label}\n  SECTION-SPECIFIC GUIDANCE (ALWAYS FOLLOW THIS): ${context}`;
      }
      return `- "${id}": ${label}`;
    })
    .join("\n");

  // Build style guide block (empty string if no style guide)
  const styleGuideBlock = template.styleGuide
    ? `\n\nWRITING STYLE GUIDE:\nMimic the following writing style in your output. Match the tone, sentence structure, formatting preferences, abbreviation usage, and level of detail described below:\n${template.styleGuide}\n`
    : "";

  // Variable interpolation (works for both custom and default prompts)
  const interpolate = (prompt: string) =>
    prompt
      .replace(/\{\{sections\}\}/g, sectionList)
      .replace(/\{\{language\}\}/g, langLabel)
      .replace(/\{\{languageCode\}\}/g, language)
      .replace(/\{\{styleGuide\}\}/g, styleGuideBlock);

  // Use custom system prompt if set
  if (template.systemPrompt) {
    return interpolate(template.systemPrompt);
  }

  return interpolate(`You are a medical documentation assistant. You MUST follow these rules strictly:

CRITICAL — SECTION-SPECIFIC GUIDANCE OVERRIDES ALL:
If a section below has "SECTION-SPECIFIC GUIDANCE", that guidance ALWAYS takes absolute precedence over any general rule or instruction. Follow section-specific guidance exactly as written, even if it contradicts other rules.

1. INSUFFICIENT CONTEXT CHECK: Before generating, assess whether the provided input contains enough meaningful clinical information (symptoms, findings, diagnoses, treatments, etc.) to produce a useful medical note. If the input is too vague, too short, or lacks any real clinical content (e.g. just a greeting, a single word, or unrelated text), return ONLY this exact JSON: {"insufficient_context": true}. Do NOT attempt to generate a note from insufficient input.

2. STRICT GROUNDING — NO ASSUMPTION MODE: Only use information explicitly present in the provided transcript chunks, uploaded file contents, and doctor's notes. Do NOT infer, assume, estimate, or hallucinate any medical facts. If a value (age, duration, measurement, dosage, etc.) or medical fact (symptom, finding, diagnosis, procedure) is not explicitly stated, do NOT guess — omit it entirely. Do NOT upgrade diagnosis severity beyond what is explicitly stated (e.g. do not write STEMI when only non-STEMI or ACS is mentioned, do not write malignant when only benign is stated). When in doubt about severity, use the less severe term.

2a. NEVER FABRICATE MISSING CLINICAL DIMENSIONS: If a numeric value appears in the source WITHOUT a unit or dimension (e.g. the patient says "fajčím 15" with no "cigariet/deň" and no "rokov"), you MUST NOT invent the missing dimension. "15 cigariet denne" is WRONG. "fajčí 15 rokov" is WRONG. The correct behaviour is to preserve the raw value and explicitly mark the ambiguity — write e.g. "fajčí 15 (bližšie nešpecifikované)" in Slovak, "kouří 15 (blíže nespecifikováno)" in Czech, or "smokes 15 (not further specified)" in English. The same principle applies to EVERY missing clinical dimension: frequency ("per day" vs "per week"), duration ("years" vs "months"), laterality (left/right), severity, dosage strength, route of administration, temporal anchor. If the source does not literally state it, do NOT fill it in — even if one interpretation is statistically more common. Correctness > completeness: a shorter, vaguer statement is always preferable to a confident fabrication. This rule overrides any stylistic preference for complete sentences.

3. SOURCE PRIORITY (highest to lowest):
   1. Actual spoken transcript — always takes precedence
   2. Doctor's additional notes
   3. Uploaded documents (lab results, referrals, etc.)
   If sources conflict, prefer the higher-priority source.

4. OUTPUT LANGUAGE: Write ALL content exclusively in {{language}}. This includes section content, the patient letter, and the encounter title. The only exceptions are established Latin/international medical terminology (e.g. "status praesens", "per os") and proper nouns (drug brand names, institution names). Do not mix languages.

5. MISSING SECTIONS: If a section or subsection has no relevant information from the source material, output an empty string "" for that key. Do NOT write placeholder text like "Not stated" or "Neuvedené" — just use "".

6. FORMATTING: Use bullet points (starting with "- ") for lists of diagnoses, ICD codes, medications, and action items — they are much easier to scan. For diagnoses/ICD codes, put the code first, then the name (e.g. "- I10 Esenciálna hypertenzia"). For plans and recommendations, use one bullet per action. Narrative sections (history, examination findings) should remain as flowing prose paragraphs — do not bullet-ify everything.

7. FORMAT: Return valid JSON with the following keys:
   - One key for each section ID listed below, with the section content as a string value (or "" if no information).
   - A "letter" key with a patient-friendly summary letter.
   - A "title" key with a short encounter title (max 6 words) in {{language}}.
     TITLE RULES:
     - The title MUST be consistent with the primary diagnosis in the assessment/conclusion section. Use the main ICD diagnosis description (or a close paraphrase) as the basis.
     - Do NOT include severity qualifiers (STEMI, non-STEMI, malignant, benign, acute, chronic) unless the exact qualifier appears in the source material AND in the primary diagnosis code's description.
     - Do NOT include anatomical localisation (anterior, lateral, inferior, left, right, wall-specific descriptors) unless it appears in the primary diagnosis description.
     - When in doubt, use a more general title that the codes actually support.
     Example — if the primary diagnosis is "I21 Akútny infarkt myokardu", the title should be "Akútny infarkt myokardu", NOT "Akútny STEMI laterálnej steny".

TEMPLATE SECTIONS (fill each one, or "" if no relevant information):
{{sections}}
{{styleGuide}}`);
}

/**
 * Build the user message for template-based generation.
 *
 * When `validatedFacts` is provided (Phase 2), the message opens with a
 * VALIDATED CLINICAL FACTS block that acts as the factual contract: every
 * statement in the generated report must correspond to one of these facts.
 * The source material that follows is included for phrasing/context only.
 */
export function buildTemplateUserMessage(
  chunks: string[],
  template: Template,
  doctorNotes?: string,
  fileTexts?: { name: string; type: string; text: string }[],
  validatedFacts?: ExtractedFacts,
): string {
  const allIds = flattenSectionIds(template);
  const parts: string[] = [];

  if (validatedFacts && countFacts(validatedFacts) > 0) {
    const factList = formatFactsForPrompt(validatedFacts);
    parts.push(
      `VALIDATED CLINICAL FACTS (use ONLY these facts as the factual basis for the report — do NOT introduce clinical details that are not in this list):\n\n${factList}`,
    );
  }

  if (chunks.length > 0) {
    const numberedChunks = chunks
      .map((chunk, i) => `[Chunk ${i + 1}]:\n${chunk}`)
      .join("\n\n");
    const heading =
      validatedFacts && countFacts(validatedFacts) > 0
        ? "SOURCE MATERIAL — TRANSCRIPT CHUNKS (phrasing and context reference only; every clinical fact must trace back to the VALIDATED CLINICAL FACTS block above)"
        : "Here are the transcript chunks from a medical consultation";
    parts.push(`${heading}:\n\n${numberedChunks}`);
  }

  if (fileTexts && fileTexts.length > 0) {
    const fileSection = fileTexts
      .map((f, i) => `[File ${i + 1}: ${f.name}]:\n${f.text}`)
      .join("\n\n");
    parts.push(`UPLOADED FILE CONTENTS:\n\n${fileSection}`);
  }

  if (doctorNotes) {
    parts.push(`DOCTOR'S ADDITIONAL NOTES:\n${doctorNotes}`);
  }

  parts.push(
    `Fill in each template section based ONLY on the information above. Return valid JSON with keys: ${allIds.map((id) => `"${id}"`).join(", ")}, "letter", and "title".`,
  );

  return parts.join("\n\n");
}

/**
 * Model fallback chain for generation — if the primary model is overloaded,
 * try the next one in the list before giving up.
 */
export const GENERATION_MODELS = [
  "claude-opus-4-6", // Primary
  "claude-sonnet-4-6", // Fallback 1
  "claude-sonnet-4-5-20250929", // Fallback 2
  "claude-sonnet-4-20250514", // Fallback 3
] as const;

export const GENERATION_MODEL = GENERATION_MODELS[0];

/** Delay (ms) before retrying with the next fallback model. */
export const MODEL_FALLBACK_DELAY = 2000;

/** Model used for the dedicated title-generation pass. */
export const TITLE_GENERATION_MODEL = "claude-haiku-4-5-20251001";

/**
 * Build the strict system prompt for the dedicated title-generation call.
 * Exported for testing.
 */
export function buildTitleSystemPrompt(language: SupportedLanguage): string {
  const langLabel = LANGUAGE_LABELS[language];
  return `You write concise, natural-sounding encounter titles for medical notes.

STRICT RULES:
1. Output ONLY the title text — no JSON, no quotes, no explanations, no trailing punctuation.
2. Maximum 6 words.
3. Write the title in ${langLabel}.
4. Base the title ONLY on the diagnosis descriptions provided. You MAY shorten or simplify wording for readability, but you MUST NOT add any clinical detail, anatomical localisation, laterality, severity qualifier, stage, or acronym that is not already literally present in the primary diagnosis description.
5. Use the FIRST (primary) diagnosis as the basis. Ignore symptom codes (R00–R99) if a disease diagnosis is present. Ignore secondary/comorbid diagnoses.
6. Do NOT include the ICD code itself in the title.
7. When uncertain, prefer a shorter, more general wording taken verbatim from the diagnosis description.

GOOD examples:
  Diagnoses: "I21 Akútny infarkt myokardu"
  Title: Akútny infarkt myokardu

  Diagnoses: "I21.0 Akútny transmurálny infarkt myokardu prednej steny"
  Title: Akútny infarkt myokardu prednej steny

  Diagnoses: "J18.9 Zápal pľúc, nešpecifikovaný"
  Title: Zápal pľúc

BAD examples (never do this):
  Diagnoses: "I21.0 Akútny transmurálny infarkt myokardu prednej steny"
  BAD Title: "STEMI laterálnej steny" — adds "STEMI" and changes "anterior" to "lateral"
  BAD Title: "Akútny STEMI prednej steny" — adds "STEMI" which is not in the description`;
}

/**
 * Build the user message for the dedicated title-generation call.
 * Exported for testing.
 */
export function buildTitleUserMessage(icdCodes: CandidateIcdCode[]): string {
  const icdList = icdCodes.map((c) => `${c.code} ${c.description}`).join("\n");
  return `DIAGNOSES (primary first):\n${icdList}\n\nOutput only the title, nothing else.`;
}

/**
 * Clean a raw title string returned by the LLM — strip quotes, trailing
 * punctuation, and collapse whitespace. Exported for testing.
 */
export function sanitizeGeneratedTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/[.!?。，、]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate a short, natural-sounding encounter title grounded strictly in the
 * extracted ICD codes.
 *
 * Why a dedicated pass:
 * - When we asked the main Opus generation call to produce a `title` alongside
 *   all report sections, the model would occasionally invent clinical details
 *   (e.g. "STEMI laterálnej steny" when the actual ICD was I21.0 "Akútny
 *   transmurálny infarkt myokardu prednej steny"). The title was being written
 *   from the model's own evolving interpretation, not from the validated
 *   diagnosis.
 * - This function isolates title generation into a tiny Haiku call whose ONLY
 *   input is the list of ICD codes that were actually extracted from the
 *   generated note (after CSV validation). There is no transcript, no doctor
 *   notes, no room for the model to drift.
 * - Runs at temperature 0 with a strict prompt that forbids adding anything
 *   not already present in the primary diagnosis description.
 *
 * Returns an empty string on failure or when no ICDs are available — callers
 * should fall back to the raw ICD description or a previous title.
 */
export async function generateEncounterTitle(
  icdCodes: CandidateIcdCode[],
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string> {
  if (icdCodes.length === 0) return "";

  const systemPrompt = buildTitleSystemPrompt(language);
  const userMessage = buildTitleUserMessage(icdCodes);

  try {
    const response = await anthropic().messages.create({
      model: TITLE_GENERATION_MODEL,
      max_tokens: 64,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    if (ctx) {
      logUsage({
        userId: ctx.userId,
        visitId: ctx.visitId,
        provider: "anthropic",
        model: TITLE_GENERATION_MODEL,
        operation: "generate_title",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
    }

    const raw =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    return sanitizeGeneratedTitle(raw);
  } catch (err) {
    logger.warn(
      `[generate] Dedicated title generation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return "";
  }
}

/**
 * Generate a medical document from a template, transcript chunks, and optional doctor notes.
 *
 * Uses single-pass Opus generation with fallback chain for reliability.
 */

export async function generateFromTemplate(
  chunks: string[],
  template: Template,
  language: SupportedLanguage,
  sectionLabels: Record<string, string>,
  doctorNotes?: string,
  fileTexts?: { name: string; type: string; text: string }[],
  ctx?: UsageContext,
  clinicalAnalysis?: ClinicalAnalysis,
  sectionContexts?: Record<string, string>,
  onSection?: (id: string, title: string, content: string) => void,
  validatedFacts?: ExtractedFacts,
): Promise<{
  generatedNote: string;
  letter: string;
  suggestedTitle: string;
  extractedIcdCodes: CandidateIcdCode[];
  /** Exact system prompt sent to the generator (for fingerprinting). */
  systemPrompt: string;
  /** Exact user message sent to the generator (for fingerprinting). */
  userMessage: string;
}> {
  const allIds = flattenSectionIds(template);
  const sectionIdSet = new Set(allIds);
  const userMessage = buildTemplateUserMessage(
    chunks,
    template,
    doctorNotes,
    fileTexts,
    validatedFacts,
  );

  // Build system prompt, enriched with specialty context if analysis available
  let systemPrompt = buildTemplateSystemPrompt(
    template,
    language,
    sectionLabels,
    sectionContexts,
  );
  if (clinicalAnalysis) {
    systemPrompt = buildEnrichedSystemPrompt(
      systemPrompt,
      clinicalAnalysis,
      language,
    );
  }

  logger.debug(
    `[generate] Streaming generation — system: ${systemPrompt.length} chars, user: ${userMessage.length} chars`,
  );

  const startTime = Date.now();

  // Stream response so we can emit sections as they complete
  let accumulated = "";
  const emittedSections = new Set<string>();

  const stream = anthropic().messages.stream({
    model: GENERATION_MODEL,
    max_tokens: 8192,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  stream.on("text", (delta) => {
    accumulated += delta;
    if (onSection) {
      extractSectionsFromStream(
        accumulated,
        sectionIdSet,
        emittedSections,
        sectionLabels,
        onSection,
      );
    }
  });

  const finalMessage = await stream.finalMessage();

  const elapsed = Date.now() - startTime;
  logger.debug(
    `[generate] Generation (${GENERATION_MODEL}) — ${elapsed}ms, tokens: ${finalMessage.usage.input_tokens} in / ${finalMessage.usage.output_tokens} out`,
  );

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "anthropic",
      model: GENERATION_MODEL,
      operation: "generate_template",
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    });
  }

  const text =
    finalMessage.content[0].type === "text" ? finalMessage.content[0].text : "";

  const parsed = extractJson<Record<string, string | boolean>>(text);

  // Check if Claude determined there's insufficient context
  if (parsed.insufficient_context === true) {
    throw new InsufficientContextError();
  }

  // Extract letter and title, remove from section contents
  const letter =
    typeof parsed.letter === "string"
      ? parsed.letter
      : JSON.stringify(parsed.letter || "");
  delete parsed.letter;

  const suggestedTitle = typeof parsed.title === "string" ? parsed.title : "";
  delete parsed.title;

  // Fill section contents (empty string for missing keys)
  const sectionContents: Record<string, string> = {};
  for (const id of allIds) {
    const value = parsed[id];
    sectionContents[id] = typeof value === "string" ? value : "";
  }

  // Validate ICD descriptions against canonical CSV data
  // Replaces any hallucinated/paraphrased descriptions with exact CSV text
  for (const id of allIds) {
    if (sectionContents[id]) {
      sectionContents[id] = validateIcdDescriptions(
        sectionContents[id],
        language,
      );
    }
  }

  // Extract the ICD codes that actually appear in the generated report.
  // This becomes the source of truth for the sidebar `candidateIcdCodes`,
  // replacing the Pass-1 Haiku list which was only a hint to Opus.
  let extractedIcdCodes = extractIcdCodesFromSections(
    sectionContents,
    language,
  );

  // Pass 2.5 — Defensive certainty enforcement. Pass 1.7 already filtered
  // the candidate list before sending it to Opus, and the system prompt
  // forbids inventing codes. Belt-and-braces: if Opus ignored the prompt
  // and emitted a code that isn't in the pre-filtered candidate set, strip
  // it from both the sidebar list AND the rendered section text. This is
  // the second gate that makes the final ICD set deterministic regardless
  // of LLM sampling drift.
  if (clinicalAnalysis) {
    const allowedCodes = new Set(
      clinicalAnalysis.candidateIcdCodes.map((c) => c.code),
    );
    const disallowed = extractedIcdCodes.filter(
      (c) => !allowedCodes.has(c.code),
    );
    if (disallowed.length > 0) {
      logger.warn(
        `[generate] Defensive ICD filter — stripping ${disallowed.length} ungrounded code(s) Opus emitted despite prompt: ${disallowed.map((c) => c.code).join(", ")}`,
      );
      extractedIcdCodes = extractedIcdCodes.filter((c) =>
        allowedCodes.has(c.code),
      );
      // Strip the offending lines from the section text. We use the same
      // line-anchored regex as `extractIcdCodesFromSections` and resolve
      // each match through the CSV so `I210` and `I21.0` collapse to the
      // same canonical code before the allow-list check.
      const stripRegex =
        /^(\s*[-•*]?\s*)([A-Z]\d{2}(?:\.\d{1,4})?)\s+([^\n]*)$/gm;
      for (const id of allIds) {
        const text = sectionContents[id];
        if (!text) continue;
        sectionContents[id] = text.replace(
          stripRegex,
          (line, _bullet, code) => {
            const [resolved] = resolveIcdCodes([code], language);
            if (resolved?.found && !allowedCodes.has(resolved.code)) {
              return ""; // drop the entire line
            }
            return line;
          },
        );
        // Collapse the blank lines we just left behind so the rendered
        // HTML doesn't grow gaps.
        sectionContents[id] = sectionContents[id]
          .replace(/\n{3,}/g, "\n\n")
          .replace(/^\n+/, "")
          .replace(/\n+$/, "");
      }
    }
  }

  // Dedicated title generation — temperature 0, input = extracted ICDs only.
  // Overrides the title from the main Opus call because the main call was
  // prone to hallucinating details (e.g. "lateral wall" when the actual ICD
  // was anterior). Falls back gracefully if the Haiku call fails or returns
  // an empty string.
  const titleFromIcd = await generateEncounterTitle(
    extractedIcdCodes,
    language,
    ctx,
  );
  const finalTitle =
    titleFromIcd || extractedIcdCodes[0]?.description || suggestedTitle;

  const generatedNote = buildTemplateHtml(
    template,
    sectionContents,
    sectionLabels,
  );

  return {
    generatedNote,
    letter,
    suggestedTitle: finalTitle,
    extractedIcdCodes,
    systemPrompt,
    userMessage,
  };
}
