import Anthropic from '@anthropic-ai/sdk';
import type { SupportedLanguage } from './types';

const anthropic = new Anthropic();

const NOT_STATED: Record<SupportedLanguage, string> = {
  en: 'Not stated',
  sk: 'Neuvedené',
  cs: 'Neuvedeno',
};

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  sk: 'Slovak',
  cs: 'Czech',
};

function buildSystemPrompt(language: SupportedLanguage): string {
  const notStated = NOT_STATED[language];
  const langLabel = LANGUAGE_LABELS[language];

  return `You are a medical documentation assistant. You MUST follow these rules strictly:

1. GROUNDING: Only use information explicitly present in the provided transcript chunks. Do NOT infer, assume, or hallucinate any medical facts.
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
  language: SupportedLanguage
): Promise<{ soap: string; letter: string }> {
  const numberedChunks = chunks
    .map((chunk, i) => `[Chunk ${i + 1}]:\n${chunk}`)
    .join('\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    system: buildSystemPrompt(language),
    messages: [
      {
        role: 'user',
        content: `Here are the transcript chunks from a medical consultation:\n\n${numberedChunks}\n\nGenerate the SOAP note and patient letter based ONLY on the information above. Return valid JSON with keys "soap" and "letter".`,
      },
    ],
  });

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '';

  // Extract JSON from the response (handles markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse structured response from Claude');
  }

  const parsed = JSON.parse(jsonMatch[0]) as { soap: string; letter: string };
  return parsed;
}
