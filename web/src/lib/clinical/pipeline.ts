import { anthropic } from "../anthropic";
import { logUsage, type UsageContext } from "../usage";
import type { SupportedLanguage } from "../types";
import type { ClinicalAnalysis } from "./types";
import { REGIONAL_TERMS } from "./regional-terms";
import { CLINICAL_CONCEPTS } from "./clinical-concepts";
import { getSpecialtyPromptPack } from "./specialty-prompts";
import { buildIcdReferenceForConcepts } from "./icd-index";
import { buildPass1SystemPrompt, buildPass1UserMessage } from "./prompts";
import { extractJson } from "./json-repair";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

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
 * Run Pass 1: Clinical Analysis via Claude Haiku.
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
  const icdReference = buildIcdReferenceForConcepts(allIcdHints, 5);

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
    model: HAIKU_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "anthropic",
      model: HAIKU_MODEL,
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
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

/**
 * Augment a base system prompt with specialty context, ICD codes,
 * and matched concepts from clinical analysis.
 */
export function buildEnrichedSystemPrompt(
  baseSystemPrompt: string,
  analysis: ClinicalAnalysis,
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

  // Add ICD code candidates
  if (analysis.candidateIcdCodes.length > 0) {
    const icdList = analysis.candidateIcdCodes
      .map((c) => `  ${c.code}: ${c.description} (confidence: ${c.confidence})`)
      .join("\n");
    parts.push(
      `\nCANDIDATE ICD-10 CODES (include relevant codes in the Assessment section):\n${icdList}`,
    );
  }

  // Add matched clinical concepts
  if (analysis.matchedConcepts.length > 0) {
    const conceptList = analysis.matchedConcepts
      .map((c) => `  - ${c.canonicalName} (${c.confidence})`)
      .join("\n");
    parts.push(`\nIDENTIFIED CLINICAL CONCEPTS:\n${conceptList}`);
  }

  // Add problem clusters
  if (analysis.problemClusters.length > 0) {
    const clusterList = analysis.problemClusters
      .map((c) => `  - ${c.label}: ${c.conceptIds.join(", ")}`)
      .join("\n");
    parts.push(`\nPROBLEM CLUSTERS:\n${clusterList}`);
  }

  return parts.join("\n");
}
