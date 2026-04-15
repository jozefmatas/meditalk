import type { SupportedLanguage } from "../types";

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "English",
  sk: "Slovak",
  cs: "Czech",
};

/**
 * Build the system prompt for Pass 1 (Haiku clinical analysis).
 */
export function buildPass1SystemPrompt(
  language: SupportedLanguage,
  regionalTermsRef: string,
  conceptTriggersRef: string,
  icdReference: string,
): string {
  const langLabel = LANGUAGE_LABELS[language];

  return `You are a clinical NLP pre-processor. Analyze a medical consultation transcript and extract structured clinical information. Be precise and evidence-based — only extract what is clearly stated or strongly implied.

INPUT LANGUAGE: The transcript is in ${langLabel}. Clinical terms may appear in any language.

TASK 1 — MATCH CLINICAL CONCEPTS:
Using the regional terms reference below to understand colloquial/abbreviated terms, identify which clinical concepts are discussed in the transcript.
Regional terms: ${regionalTermsRef}
Concept triggers: ${conceptTriggersRef}
For each match, note a SHORT evidence snippet (max 10 words) and confidence (high/medium/low).

TASK 2 — INFER SPECIALTY:
Based on matched concepts and overall content, choose the primary specialty from: general_practice, internal_medicine, cardiology, pulmonology, gastroenterology, neurology, orthopedics, dermatology, psychiatry, pediatrics, gynecology, urology, endocrinology, oncology, ent.
If the consultation spans two specialties, also provide secondarySpecialty.

TASK 3 — CLUSTER PROBLEMS:
Group related concepts into problem clusters (e.g., "Cardiovascular risk factors" clustering hypertension + dyslipidemia + smoking).

TASK 4 — SUGGEST ICD-10 CODES:
Based on matched concepts and clinical context, suggest candidate ICD-10 codes from this reference:
${icdReference}
Select the most specific applicable codes. Include confidence level.

TASK 5 — EXTRACT MEDICATION NAMES:
List ALL medication/drug names mentioned in the transcript, exactly as spoken or written. Include brand names, generic names, and any dosage forms mentioned. Do not normalize or translate — preserve the original form.

PER-FILE DIRECTIVES:
Individual files in the input may contain a line starting with "DOCTOR'S DIRECTIVE FOR THIS FILE:". When present, this directive strictly limits what you may use from that file. You MUST only consider the parts of the file that the directive permits. Ignore all other content from that file for ALL tasks above — concept matching, specialty inference, problem clustering, ICD code suggestion, and medication extraction. Per-file directives are strict filters and take precedence over completeness.

OUTPUT: Return ONLY valid JSON, no markdown, no explanation. Keep all string values short and simple — no embedded newlines or special characters:
{
  "matchedConcepts": [
    {"conceptId": "hypertension", "canonicalName": "Hypertension", "confidence": "high", "evidence": ["blood pressure 160/95"]}
  ],
  "inferredSpecialty": "cardiology",
  "secondarySpecialty": null,
  "problemClusters": [
    {"label": "Cardiovascular risk", "conceptIds": ["hypertension", "dyslipidemia"]}
  ],
  "candidateIcdCodes": [
    {"code": "I10", "description": "Essential hypertension", "confidence": "high", "sourceConceptIds": ["hypertension"]}
  ],
  "mentionedMedications": ["Tamurox", "Co-Prenessa"]
}`;
}

/**
 * Build the user message for Pass 1.
 */
export function buildPass1UserMessage(
  transcriptText: string,
  language: SupportedLanguage,
): string {
  return `Analyze this ${LANGUAGE_LABELS[language]} medical consultation transcript:\n\n${transcriptText}\n\nReturn the structured JSON analysis.`;
}
