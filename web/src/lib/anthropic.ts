import Anthropic from "@anthropic-ai/sdk";
import type { SupportedLanguage } from "./types";
import type { Template } from "./templates/types";
import { buildTemplateHtml, flattenSectionIds } from "./templates/html";
import { logUsage, type UsageContext } from "./usage";
import { buildEnrichedSystemPrompt } from "./clinical/pipeline";
import { extractJson } from "./clinical/json-repair";
import type { ClinicalAnalysis } from "./clinical/types";

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

function buildSystemPrompt(language: SupportedLanguage): string {
  const notStated = NOT_STATED[language];
  const langLabel = LANGUAGE_LABELS[language];

  return `You are a medical documentation assistant. You MUST follow these rules strictly:

1. GROUNDING: Only use information explicitly present in the provided transcript chunks, uploaded file contents, and doctor's notes. Do NOT infer, assume, or hallucinate any medical facts.
2. OUTPUT LANGUAGE: Write everything in ${langLabel}, except medical terms and proper nouns which should be kept as-is.
3. MISSING INFORMATION: If a SOAP section has no relevant information in the chunks, write "${notStated}".
4. FORMAT: Return valid JSON with exactly two keys: "soap" and "letter".

SOAP NOTE FORMAT:
S (Subjective): Patient's complaints, symptoms, history as reported.
O (Objective): Observable/measurable findings mentioned.
A (Assessment): Diagnosis or clinical impression.
P (Plan): Treatment plan, medications, follow-up.

PATIENT LETTER FORMAT:
A clear, patient-friendly summary letter of the consultation in ${langLabel}. Use simple language. Include what was discussed, any diagnoses, and next steps.`;
}

/**
 * Generate a SOAP note and patient letter from transcript chunks.
 *
 * @param chunks    Array of transcript text chunks
 * @param language  Output language
 * @returns         Object with `soap` and `letter` strings
 */
export async function generateSOAPAndLetter(
  chunks: string[],
  language: SupportedLanguage,
): Promise<{ soap: string; letter: string }> {
  const numberedChunks = chunks
    .map((chunk, i) => `[Chunk ${i + 1}]:\n${chunk}`)
    .join("\n\n");

  const response = await anthropic().messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: buildSystemPrompt(language),
    messages: [
      {
        role: "user",
        content: `Here are the transcript chunks from a medical consultation:\n\n${numberedChunks}\n\nGenerate the SOAP note and patient letter based ONLY on the information above. Return valid JSON with keys "soap" and "letter".`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const parsed = extractJson<{
    soap: string | Record<string, string>;
    letter: string;
  }>(text);

  // Claude sometimes returns soap as {S, O, A, P} object — normalize to string
  let soap: string;
  if (typeof parsed.soap === "object" && parsed.soap !== null) {
    soap = Object.entries(parsed.soap)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n\n");
  } else {
    soap = parsed.soap;
  }

  // Same safety check for letter
  const letter =
    typeof parsed.letter === "string"
      ? parsed.letter
      : JSON.stringify(parsed.letter);

  return { soap, letter };
}

/**
 * Default system prompt template with interpolation placeholders.
 * Used when a template does not define its own `systemPrompt`.
 *
 * Available placeholders:
 * - {{sections}}      — formatted list of section IDs with labels
 * - {{language}}      — full language name ("Slovak", "Czech", "English")
 * - {{languageCode}}  — ISO code ("sk", "cs", "en")
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a medical documentation assistant. You MUST follow these rules strictly:

1. INSUFFICIENT CONTEXT CHECK: Before generating, assess whether the provided input contains enough meaningful clinical information (symptoms, findings, diagnoses, treatments, etc.) to produce a useful medical note. If the input is too vague, too short, or lacks any real clinical content (e.g. just a greeting, a single word, or unrelated text), return ONLY this exact JSON: {"insufficient_context": true}. Do NOT attempt to generate a note from insufficient input.
2. STRICT GROUNDING: Only use information explicitly present in the provided transcript chunks, uploaded file contents, and doctor's notes. Do NOT infer, assume, estimate, or hallucinate any medical facts. If a value (age, duration, measurement, dosage, etc.) is not explicitly stated, do NOT guess — omit it entirely.
3. OUTPUT LANGUAGE: Write ALL content exclusively in {{language}}. This includes section content, the patient letter, and the encounter title. The only exceptions are established Latin/international medical terminology (e.g. "status praesens", "per os") and proper nouns (drug brand names, institution names). Do not mix languages.
4. MISSING SECTIONS: If a section or subsection has no relevant information from the source material, output an empty string "" for that key. Do NOT write placeholder text like "Not stated" or "Neuvedené" — just use "".
5. FORMATTING: Use bullet points (starting with "- ") for lists of diagnoses, ICD codes, medications, and action items — they are much easier to scan. For diagnoses/ICD codes, put the code first, then the name (e.g. "- I10 Esenciálna hypertenzia"). For plans and recommendations, use one bullet per action. Narrative sections (history, examination findings) should remain as flowing prose paragraphs — do not bullet-ify everything.
6. FORMAT: Return valid JSON with the following keys:
   - One key for each section ID listed below, with the section content as a string value (or "" if no information).
   - A "letter" key with a patient-friendly summary letter.
   - A "title" key with a short encounter title (max 6 words) summarizing the main reason for the visit in {{language}}. Example: "Kontrola krvného tlaku" or "Acute back pain consultation".

TEMPLATE SECTIONS (fill each one, or "" if no relevant information):
{{sections}}

PATIENT LETTER:
A clear, patient-friendly summary letter of the consultation in {{language}}. Use simple language. Include what was discussed, any diagnoses, and next steps.`;

/**
 * Interpolate placeholders in a prompt template string.
 */
function interpolatePrompt(
  promptTemplate: string,
  vars: { sections: string; language: string; languageCode: string },
): string {
  return promptTemplate
    .replace(/\{\{sections\}\}/g, vars.sections)
    .replace(/\{\{language\}\}/g, vars.language)
    .replace(/\{\{languageCode\}\}/g, vars.languageCode);
}

/**
 * Build a system prompt for template-based generation.
 *
 * If the template has a custom `systemPrompt`, it is used with placeholder
 * interpolation. Otherwise the DEFAULT_SYSTEM_PROMPT is used.
 */
export function buildTemplateSystemPrompt(
  template: Template,
  language: SupportedLanguage,
  sectionLabels: Record<string, string>,
): string {
  const langLabel = LANGUAGE_LABELS[language];
  const allIds = flattenSectionIds(template);

  const sectionList = allIds
    .map((id) => `- "${id}": ${sectionLabels[id] || id}`)
    .join("\n");

  const promptTemplate = template.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  let prompt = interpolatePrompt(promptTemplate, {
    sections: sectionList,
    language: langLabel,
    languageCode: language,
  });

  if (template.styleExamples && template.styleExamples.length > 0) {
    const examples = template.styleExamples
      .map((ex) => `--- ${ex.name} ---\n${ex.text}`)
      .join("\n\n");
    prompt += `\n\nSTYLE REFERENCE (match this writing style, tone, and formatting):\n${examples}`;
  }

  return prompt;
}

/**
 * Build the user message for template-based generation.
 */
export function buildTemplateUserMessage(
  chunks: string[],
  template: Template,
  doctorNotes?: string,
  fileTexts?: { name: string; type: string; text: string }[],
): string {
  const allIds = flattenSectionIds(template);
  const parts: string[] = [];

  if (chunks.length > 0) {
    const numberedChunks = chunks
      .map((chunk, i) => `[Chunk ${i + 1}]:\n${chunk}`)
      .join("\n\n");
    parts.push(
      `Here are the transcript chunks from a medical consultation:\n\n${numberedChunks}`,
    );
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
 * Generate a medical document from a template, transcript chunks, and optional doctor notes.
 */
export const GENERATION_MODEL = "claude-opus-4-6";

export async function generateFromTemplate(
  chunks: string[],
  template: Template,
  language: SupportedLanguage,
  sectionLabels: Record<string, string>,
  doctorNotes?: string,
  fileTexts?: { name: string; type: string; text: string }[],
  ctx?: UsageContext,
  clinicalAnalysis?: ClinicalAnalysis,
): Promise<{ generatedNote: string; letter: string; suggestedTitle: string }> {
  const allIds = flattenSectionIds(template);
  const userMessage = buildTemplateUserMessage(
    chunks,
    template,
    doctorNotes,
    fileTexts,
  );

  // Build system prompt, enriched with specialty context if analysis available
  let systemPrompt = buildTemplateSystemPrompt(
    template,
    language,
    sectionLabels,
  );
  if (clinicalAnalysis) {
    systemPrompt = buildEnrichedSystemPrompt(systemPrompt, clinicalAnalysis);
  }

  console.log(
    `[generate] prompt sizes — system: ${systemPrompt.length} chars, user: ${userMessage.length} chars`,
  );

  const response = await anthropic().messages.create({
    model: GENERATION_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  console.log(
    `[generate] Anthropic usage — input: ${response.usage.input_tokens}, output: ${response.usage.output_tokens}, stop: ${response.stop_reason}`,
  );

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "anthropic",
      model: GENERATION_MODEL,
      operation: "generate_template",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

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

  const generatedNote = buildTemplateHtml(
    template,
    sectionContents,
    sectionLabels,
  );

  return { generatedNote, letter, suggestedTitle };
}
