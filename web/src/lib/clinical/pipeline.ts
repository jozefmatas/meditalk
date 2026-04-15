import { anthropic } from "../anthropic";
import { logUsage, type UsageContext } from "../usage";
import type { SupportedLanguage } from "../types";
import type { ClinicalAnalysis, CandidateIcdCode } from "./types";
import { REGIONAL_TERMS } from "./regional-terms";
import { CLINICAL_CONCEPTS } from "./clinical-concepts";
import { getSpecialtyPromptPack } from "./specialty-prompts";
import { buildIcdReferenceForConcepts } from "./icd-index";
import { searchMedications, correctMedicationName } from "./medication-index";
import { buildPass1SystemPrompt, buildPass1UserMessage } from "./prompts";
import { extractJson } from "./json-repair";

// Pass 1 uses Sonnet 4.6 — Haiku 4.5 was unreliable at distinguishing
// anatomically-specific ICD codes (e.g. I21.0 anterior wall vs I21.2
// other sites including lateral wall MI). Sonnet 4.6 handles anatomy
// and reads the expanded ICD reference window far more reliably.
const PASS1_MODEL = "claude-sonnet-4-6";

/**
 * Build regional terms reference filtered by language.
 */
function buildRegionalTermsReference(language: SupportedLanguage): string {
  const relevant = REGIONAL_TERMS.filter((t) => t.languages.includes(language));
  if (relevant.length === 0) return "(none)";
  return relevant
    .map((t) => `  ${t.variants.join(" / ")} → ${t.standard}`)
    .join("\n");
}

/**
 * Build concept triggers reference filtered by language.
 */
function buildConceptTriggersReference(language: SupportedLanguage): string {
  return CLINICAL_CONCEPTS.map(
    (c) =>
      `  [${c.id}] ${c.canonicalName}: ${c.triggers[language]?.join(", ") || "(no triggers)"}`,
  ).join("\n");
}

/**
 * Run Pass 1: Clinical Analysis via Claude Sonnet 4.6.
 *
 * Analyzes transcript chunks to extract normalized text, matched concepts,
 * inferred specialty, problem clusters, and candidate ICD-10 codes.
 */
export async function runClinicalAnalysis(
  chunks: string[],
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<ClinicalAnalysis> {
  const transcriptText = chunks.join("\n\n");

  // Collect ICD category hints from all concepts for a focused reference
  const allIcdHints = [
    ...new Set(CLINICAL_CONCEPTS.flatMap((c) => c.icdHints)),
  ];
  // Use a wider window (15 per category) so Pass 1 sees all the
  // anatomically-specific variants (e.g. I21.0/.1/.2/.3/.4) rather
  // than being forced to guess from a truncated list.
  const icdReference = buildIcdReferenceForConcepts(allIcdHints, 15, language);

  const regionalRef = buildRegionalTermsReference(language);
  const conceptRef = buildConceptTriggersReference(language);

  const systemPrompt = buildPass1SystemPrompt(
    language,
    regionalRef,
    conceptRef,
    icdReference,
  );
  const userMessage = buildPass1UserMessage(transcriptText, language);

  const response = await anthropic().messages.create({
    model: PASS1_MODEL,
    max_tokens: 4096,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "anthropic",
      model: PASS1_MODEL,
      operation: "clinical_analysis",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const parsed = extractJson<Record<string, unknown>>(text);

  return {
    matchedConcepts:
      (parsed.matchedConcepts as ClinicalAnalysis["matchedConcepts"]) || [],
    inferredSpecialty:
      (parsed.inferredSpecialty as ClinicalAnalysis["inferredSpecialty"]) ||
      "general_practice",
    secondarySpecialty:
      (parsed.secondarySpecialty as ClinicalAnalysis["secondarySpecialty"]) ||
      undefined,
    problemClusters:
      (parsed.problemClusters as ClinicalAnalysis["problemClusters"]) || [],
    candidateIcdCodes:
      (parsed.candidateIcdCodes as ClinicalAnalysis["candidateIcdCodes"]) || [],
    mentionedMedications: (parsed.mentionedMedications as string[]) || [],
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

/**
 * Pre-render the ICD-10 block that Opus must copy verbatim into the
 * Záver/Assessment section. Sorted alphabetically by code so the output
 * is deterministic regardless of the order Pass 1 emitted them.
 */
export function buildPreRenderedIcdBlock(
  candidates: CandidateIcdCode[],
): string {
  return [...candidates]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((c) => `- ${c.code} ${c.description}`)
    .join("\n");
}

/**
 * Augment a base system prompt with specialty context, ICD codes,
 * matched concepts, and medication validation from clinical analysis.
 *
 * When `hasValidatedFacts` is true, concepts and problem clusters are
 * omitted — they are advisory metadata useful for the grounding path
 * but add unnecessary prompt tokens when the LLM is doing a pure
 * formatting task over pre-assigned facts.
 */
export function buildEnrichedSystemPrompt(
  baseSystemPrompt: string,
  analysis: ClinicalAnalysis,
  locale: SupportedLanguage,
  hasValidatedFacts?: boolean,
): string {
  const parts: string[] = [baseSystemPrompt];

  // Add specialty prompt pack
  const pack = getSpecialtyPromptPack(analysis.inferredSpecialty);
  if (pack) {
    parts.push(`\n${pack.systemPromptAddendum}`);
    parts.push(`\nTERMINOLOGY: ${pack.terminologyNotes}`);

    if (pack.emphasizedSections.length > 0) {
      parts.push(
        `\nEMPHASIZED SECTIONS: Pay special attention to these sections for this specialty: ${pack.emphasizedSections.join(", ")}. Provide more detail in these sections when information is available.`,
      );
    }
  }

  // Resolve mentioned medications against the approved database.
  // Uses fuzzy matching so transcription misspellings (e.g. "Koprenesa"
  // for "Co-Prenessa") are resolved to the correct approved name.
  if (analysis.mentionedMedications.length > 0) {
    const resolvedMeds: string[] = [];
    for (const medName of analysis.mentionedMedications) {
      const matches = searchMedications(medName, 3, locale);
      if (matches.length > 0) {
        resolvedMeds.push(
          ...matches.map((m) => `  ${m.name} (${m.activeIngredient})`),
        );
      } else {
        // Try fuzzy matching for misspelled names
        const correction = correctMedicationName(medName, locale);
        if (correction) {
          resolvedMeds.push(
            `  ${correction.entry.name} (${correction.entry.activeIngredient}) [corrected from "${medName}"]`,
          );
        } else {
          resolvedMeds.push(`  ${medName} [not found in approved list]`);
        }
      }
    }

    if (hasValidatedFacts) {
      // When facts are present, FACT VALUE FIDELITY already constrains the
      // LLM to use only provided facts. The medication block only needs the
      // lookup table and correction handling.
      parts.push(`\nVERIFIED MEDICATIONS (locale: ${locale}):
${resolvedMeds.join("\n")}
Use corrected names where marked [corrected from "..."]. For [not found in approved list], use the dictated name without annotations.`);
    } else {
      parts.push(`\nVERIFIED MEDICATIONS FROM APPROVED LIST (locale: ${locale}):
${resolvedMeds.join("\n")}
RULES:
- Only include medications EXPLICITLY mentioned in the transcript or documents
- Use the EXACT medication names from the VERIFIED MEDICATIONS list above when documenting
- Include both brand name and active ingredient
- Do NOT add medications that are "commonly prescribed" for a condition unless they are explicitly mentioned in the source material
- If a medication is marked [corrected from "..."], use the CORRECTED name (it was auto-matched from a misspelling)
- If a medication is marked [not found in approved list], still include it in the clinical note using EXACTLY the name the doctor dictated — do NOT add any warning label, bracket, or annotation around it`);
    }
  }

  // Add pre-rendered ICD block — Opus must copy this verbatim
  if (analysis.candidateIcdCodes.length > 0) {
    const icdBlock = buildPreRenderedIcdBlock(analysis.candidateIcdCodes);
    parts.push(
      `\nICD-10 BLOCK (VERBATIM) — Copy the following block EXACTLY as-is into the Záver/Assessment section. The Záver/Assessment section MUST contain ONLY these ICD-10 code lines — no additional narrative text, clinical summary, impressions, or commentary. Do NOT reorder, add, remove, rephrase, or modify any line. Do NOT add any other ICD codes. Every code below has been validated by a deterministic certainty filter — codes not in this list MUST NOT appear anywhere in your output:\n${icdBlock}`,
    );
  } else {
    parts.push(
      `\nICD-10 CODES: No ICD-10 codes were identified with sufficient certainty for this encounter. Do NOT include ANY ICD-10 codes in your output. Do NOT invent, guess, or add ICD codes based on clinical context.`,
    );
  }

  // Add matched clinical concepts (skip when facts are pre-assigned —
  // concepts are advisory metadata that adds prompt tokens without
  // improving output quality in the fact-based formatting path)
  if (!hasValidatedFacts && analysis.matchedConcepts.length > 0) {
    const conceptList = analysis.matchedConcepts
      .map((c) => `  - ${c.canonicalName} (${c.confidence})`)
      .join("\n");
    parts.push(`\nIDENTIFIED CLINICAL CONCEPTS:\n${conceptList}`);
  }

  // Add problem clusters (same reasoning as concepts)
  if (!hasValidatedFacts && analysis.problemClusters.length > 0) {
    const clusterList = analysis.problemClusters
      .map((c) => `  - ${c.label}: ${c.conceptIds.join(", ")}`)
      .join("\n");
    parts.push(`\nPROBLEM CLUSTERS:\n${clusterList}`);
  }

  return parts.join("\n");
}
