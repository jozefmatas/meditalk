/**
 * Tiered section renderer — splits generation into three rendering tiers:
 *
 * 1. **Deterministic** (no LLM): LA (medications), Assessment (ICD block)
 * 2. **Haiku batch** (one call): History + exam sections
 * 3. **Opus narrative** (one call): TO/HPI + Plan
 *
 * Haiku and Opus run in parallel. Deterministic sections emit instantly.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupportedLanguage } from "../types";
import type { Template, TemplateSection } from "../templates/types";
import { flattenSectionIds } from "../templates/html";
import { logUsage, type UsageContext } from "../usage";
import { extractJson } from "./json-repair";
import { extractSectionsFromStream } from "../api/sse";
import type { ClinicalAnalysis, SpecialtyId } from "./types";
import type { ExtractedFact } from "./fact-extraction";
import { getSpecialtyPromptPack } from "./specialty-prompts";
import {
  classifySection,
  type SectionRole,
} from "./section-routing-validator";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Tier classification
// ---------------------------------------------------------------------------

export type RenderTier = "deterministic" | "haiku" | "opus";

export interface SectionTier {
  id: string;
  label: string;
  role: SectionRole;
  tier: RenderTier;
}

const ROLE_TO_TIER: Record<SectionRole, RenderTier> = {
  medications: "deterministic",
  assessment: "deterministic",
  chiefComplaint: "opus",
  plan: "opus",
  // Everything else → haiku
  substanceUse: "haiku",
  allergies: "haiku",
  epidemiological: "haiku",
  personalHistory: "haiku",
  socialHistory: "haiku",
  findings: "haiku",
  other: "haiku",
};

/**
 * Classify all template sections into rendering tiers.
 */
export function classifySectionTiers(
  sectionLabels: Record<string, string>,
  sectionContexts?: Record<string, string>,
): SectionTier[] {
  return Object.entries(sectionLabels).map(([id, label]) => {
    const role = classifySection(label, sectionContexts?.[id]);
    return { id, label, role, tier: ROLE_TO_TIER[role] };
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const OPUS_MODEL = "claude-opus-4-6";

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "English",
  sk: "Slovak",
  cs: "Czech",
};

// ---------------------------------------------------------------------------
// Anthropic client (reuse singleton from anthropic.ts)
// ---------------------------------------------------------------------------

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ maxRetries: 4 });
  return _anthropic;
}

// ---------------------------------------------------------------------------
// Deterministic renderers
// ---------------------------------------------------------------------------

/**
 * Render the medications section deterministically.
 * Joins medication fact values as compact inline text (comma-separated).
 */
export function renderMedications(facts: ExtractedFact[]): string {
  if (facts.length === 0) return "";
  return facts.map((f) => f.value).join(", ");
}

/**
 * Render the assessment section deterministically.
 * Returns the pre-rendered ICD block verbatim.
 */
export function renderAssessment(icdBlock?: string): string {
  if (!icdBlock) return "";
  // Strip the "- " prefix from each line — the note uses plain lines
  return icdBlock
    .split("\n")
    .map((line) => line.replace(/^- /, ""))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Haiku batch prompt builders
// ---------------------------------------------------------------------------

/**
 * Build system prompt for the Haiku batch renderer.
 */
export function buildHaikuSystemPrompt(language: SupportedLanguage): string {
  return `You are a medical documentation formatter. Write in ${LANGUAGE_LABELS[language]}.

RULES:
1. Format the pre-assigned clinical facts into compact, flowing prose for each section.
2. Preserve each fact's wording as closely as possible — only adjust grammar minimally for natural prose flow.
3. ABSOLUTELY NO BULLET POINTS — never use -, •, *, –, — as line starters. Use commas, semicolons, or periods to separate items.
4. Do NOT fabricate, infer, or add any clinical information not present in the assigned facts.
5. If a section has no facts, output an empty string "".
6. Present facts in the order shown. Do NOT reorder.
7. For UNDISTRIBUTED FINDINGS: distribute them to the most appropriate subsection based on subsection context descriptions.
8. Each section's output should be concise — compact prose, not verbose narratives.

OUTPUT: Return valid JSON with section IDs as keys and formatted text as values. No markdown, no explanation.`;
}

/**
 * Build user message for the Haiku batch renderer.
 */
export function buildHaikuUserMessage(
  sections: SectionTier[],
  factAssignment: Record<string, ExtractedFact[]>,
  sectionContexts: Record<string, string>,
  undistributedFindings: ExtractedFact[],
  unassignedFacts: ExtractedFact[],
): string {
  const lines: string[] = [];

  for (const section of sections) {
    const facts = factAssignment[section.id] ?? [];
    const context = sectionContexts[section.id] ?? "";
    lines.push(`[Section "${section.label}" (${section.id})]:`);
    if (context) lines.push(`  Context: ${context}`);
    if (facts.length === 0) {
      lines.push("  (no facts assigned)");
    } else {
      for (const f of facts) {
        lines.push(`  - ${f.value}`);
      }
    }
    lines.push("");
  }

  if (undistributedFindings.length > 0) {
    lines.push("UNDISTRIBUTED FINDINGS (distribute to appropriate subsections above based on their context):");
    for (const f of undistributedFindings) {
      lines.push(`  - ${f.value}`);
    }
    lines.push("");
  }

  if (unassignedFacts.length > 0) {
    lines.push("GENERAL CONTEXT (place in most appropriate section above):");
    for (const f of unassignedFacts) {
      lines.push(`  - ${f.value}`);
    }
    lines.push("");
  }

  lines.push(`Format each section and return valid JSON with keys: ${sections.map((s) => `"${s.id}"`).join(", ")}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Opus narrative prompt builders
// ---------------------------------------------------------------------------

/**
 * Build system prompt for the Opus narrative renderer.
 */
export function buildOpusSystemPrompt(
  language: SupportedLanguage,
  clinicalAnalysis?: ClinicalAnalysis,
  templateSpecialty?: string,
  styleGuide?: string,
): string {
  const parts: string[] = [];

  parts.push(`You are a medical documentation specialist writing clinical narratives in ${LANGUAGE_LABELS[language]}.

RULES:
1. Write rich, flowing temporal narratives for each section.
2. For chief complaint / present illness: describe onset, progression, severity, and associated symptoms in chronological order.
3. For treatment plan: describe recommendations, follow-up instructions, and clinical reasoning in flowing prose.
4. Do NOT list medications or diagnoses — they have dedicated sections elsewhere.
5. Preserve fact wording closely — only adjust grammar for natural narrative flow.
6. ABSOLUTELY NO BULLET POINTS — never use -, •, *, –, — as line starters.
7. Do NOT fabricate or infer clinical information not in the assigned facts.
8. If a section has no facts, output an empty string "".

OUTPUT: Return valid JSON with section IDs as keys and formatted text as values. No markdown, no explanation.`);

  // Add specialty prompt pack if available
  const specialty = (templateSpecialty ?? clinicalAnalysis?.inferredSpecialty) as
    | SpecialtyId
    | undefined;
  if (specialty) {
    const pack = getSpecialtyPromptPack(specialty);
    if (pack) {
      parts.push(`\nSPECIALTY GUIDANCE:\n${pack.systemPromptAddendum}`);
      if (pack.terminologyNotes) {
        parts.push(`TERMINOLOGY: ${pack.terminologyNotes}`);
      }
    }
  }

  if (styleGuide) {
    parts.push(`\nSTYLE GUIDE:\n${styleGuide}`);
  }

  return parts.join("\n");
}

/**
 * Build user message for the Opus narrative renderer.
 */
export function buildOpusUserMessage(
  sections: SectionTier[],
  factAssignment: Record<string, ExtractedFact[]>,
  sectionContexts: Record<string, string>,
  options?: {
    medicationContext?: string;
    diagnosisContext?: string;
    doctorNotes?: string;
    fileTexts?: { name: string; type: string; text: string; context?: string }[];
    visitDate?: string;
  },
): string {
  const lines: string[] = [];

  if (options?.visitDate) {
    lines.push(`ENCOUNTER DATE: ${options.visitDate}`);
    lines.push('Resolve relative temporal references ("dnes", "včera", "today", "yesterday") relative to this date.');
    lines.push("");
  }

  // Provide medication/diagnosis context for reference (NOT for listing)
  if (options?.medicationContext) {
    lines.push("MEDICATION CONTEXT (reference only — do NOT list these, they have a dedicated section):");
    lines.push(options.medicationContext);
    lines.push("");
  }

  if (options?.diagnosisContext) {
    lines.push("DIAGNOSIS CONTEXT (reference only — do NOT list these, they have a dedicated section):");
    lines.push(options.diagnosisContext);
    lines.push("");
  }

  // Sections with assigned facts
  for (const section of sections) {
    const facts = factAssignment[section.id] ?? [];
    const context = sectionContexts[section.id] ?? "";
    lines.push(`[Section "${section.label}" (${section.id})]:`);
    if (context) lines.push(`  Context: ${context}`);
    if (facts.length === 0) {
      lines.push("  (no facts assigned)");
    } else {
      for (const f of facts) {
        lines.push(`  - ${f.value}`);
      }
    }
    lines.push("");
  }

  // Doctor notes (only Opus sees raw unstructured input)
  if (options?.doctorNotes?.trim()) {
    lines.push("DOCTOR'S ADDITIONAL NOTES:");
    lines.push(options.doctorNotes);
    lines.push("");
  }

  // File texts (only Opus sees these)
  if (options?.fileTexts && options.fileTexts.length > 0) {
    lines.push("UPLOADED FILE CONTENTS:");
    for (let i = 0; i < options.fileTexts.length; i++) {
      const f = options.fileTexts[i];
      lines.push(`\n[File ${i + 1}: ${f.name}]:`);
      if (f.context) {
        lines.push(`DOCTOR'S DIRECTIVE FOR THIS FILE: ${f.context}`);
      }
      lines.push(f.text);
    }
    lines.push("");
  }

  lines.push(`Format each section and return valid JSON with keys: ${sections.map((s) => `"${s.id}"`).join(", ")}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Findings redistribution
// ---------------------------------------------------------------------------

/**
 * Collect "undistributed" findings/measurements from parent sections.
 *
 * Parent sections (those with subsections) get cleared by Pass B, so any
 * facts assigned to them would be lost. This function extracts findings
 * and measurements category facts from parent sections so they can be
 * redistributed to subsections by the Haiku batch call.
 */
export function collectUndistributedFindings(
  factAssignment: Record<string, ExtractedFact[]>,
  parentSectionIds: Set<string>,
): ExtractedFact[] {
  const undistributed: ExtractedFact[] = [];
  for (const parentId of parentSectionIds) {
    const facts = factAssignment[parentId];
    if (!facts) continue;
    for (const fact of facts) {
      if (fact.category === "findings" || fact.category === "measurements") {
        undistributed.push(fact);
      }
    }
  }
  return undistributed;
}

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

export interface RenderUsage {
  haiku: { inputTokens: number; outputTokens: number };
  opus: { inputTokens: number; outputTokens: number };
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

/**
 * Render all sections using the tiered approach.
 *
 * 1. Deterministic sections (LA, Assessment) are rendered instantly
 * 2. Haiku batch renders history + exam sections
 * 3. Opus renders narrative sections (TO/HPI, Plan)
 * 4. Haiku and Opus run in parallel
 */
export async function renderSections(
  template: Template,
  sectionLabels: Record<string, string>,
  factAssignment: Record<string, ExtractedFact[]>,
  language: SupportedLanguage,
  options?: {
    sectionContexts?: Record<string, string>;
    icdBlock?: string;
    clinicalAnalysis?: ClinicalAnalysis;
    doctorNotes?: string;
    fileTexts?: { name: string; type: string; text: string; context?: string }[];
    visitDate?: string;
    styleGuide?: string;
    templateSpecialty?: string;
    onSection?: (id: string, title: string, content: string) => void;
  },
  ctx?: UsageContext,
): Promise<{ sectionContents: Record<string, string>; usage: RenderUsage }> {
  const sectionContexts = options?.sectionContexts ?? {};
  const onSection = options?.onSection;

  // 1. Classify all sections into tiers
  const tiers = classifySectionTiers(sectionLabels, options?.sectionContexts);
  const deterministicSections = tiers.filter((t) => t.tier === "deterministic");
  const haikuSections = tiers.filter((t) => t.tier === "haiku");
  const opusSections = tiers.filter((t) => t.tier === "opus");

  const result: Record<string, string> = {};
  const usage: RenderUsage = {
    haiku: { inputTokens: 0, outputTokens: 0 },
    opus: { inputTokens: 0, outputTokens: 0 },
  };

  // 2. Render deterministic sections instantly
  for (const section of deterministicSections) {
    if (section.role === "medications") {
      const medFacts = factAssignment[section.id] ?? [];
      result[section.id] = renderMedications(medFacts);
    } else if (section.role === "assessment") {
      result[section.id] = renderAssessment(options?.icdBlock);
    } else {
      result[section.id] = "";
    }

    // Emit immediately via callback
    if (onSection) {
      onSection(section.id, section.label, result[section.id]);
    }
  }

  // 3. Build medication/diagnosis context for Opus
  const medicationContext = deterministicSections
    .filter((s) => s.role === "medications" && result[s.id])
    .map((s) => result[s.id])
    .join("; ");

  const diagnosisContext = deterministicSections
    .filter((s) => s.role === "assessment" && result[s.id])
    .map((s) => result[s.id])
    .join("\n");

  // 4. Extract undistributed findings from parent sections
  const parentIds = collectParentSectionIdsFromTemplate(template.sections);
  const undistributed = collectUndistributedFindings(factAssignment, parentIds);
  const unassigned = factAssignment["_unassigned"] ?? [];

  // 5. Run Haiku + Opus in parallel
  const haikuPromise = haikuSections.length > 0
    ? renderWithHaiku(haikuSections, factAssignment, sectionContexts, undistributed, unassigned, language, onSection, ctx)
    : Promise.resolve({ contents: {} as Record<string, string>, inputTokens: 0, outputTokens: 0 });

  const opusPromise = opusSections.length > 0
    ? renderWithOpus(opusSections, factAssignment, sectionContexts, language, {
        medicationContext: medicationContext || undefined,
        diagnosisContext: diagnosisContext || undefined,
        doctorNotes: options?.doctorNotes,
        fileTexts: options?.fileTexts,
        visitDate: options?.visitDate,
        styleGuide: options?.styleGuide,
        templateSpecialty: options?.templateSpecialty,
        clinicalAnalysis: options?.clinicalAnalysis,
        onSection,
      }, ctx)
    : Promise.resolve({ contents: {} as Record<string, string>, inputTokens: 0, outputTokens: 0 });

  const [haikuResult, opusResult] = await Promise.all([haikuPromise, opusPromise]);

  // 6. Merge results
  for (const section of haikuSections) {
    result[section.id] = haikuResult.contents[section.id] ?? "";
  }
  for (const section of opusSections) {
    result[section.id] = opusResult.contents[section.id] ?? "";
  }

  usage.haiku = { inputTokens: haikuResult.inputTokens, outputTokens: haikuResult.outputTokens };
  usage.opus = { inputTokens: opusResult.inputTokens, outputTokens: opusResult.outputTokens };

  // Fill any missing section IDs with empty strings
  const allIds = flattenSectionIds(template);
  for (const id of allIds) {
    if (!(id in result)) result[id] = "";
  }

  return { sectionContents: result, usage };
}

// ---------------------------------------------------------------------------
// Haiku batch call
// ---------------------------------------------------------------------------

async function renderWithHaiku(
  sections: SectionTier[],
  factAssignment: Record<string, ExtractedFact[]>,
  sectionContexts: Record<string, string>,
  undistributedFindings: ExtractedFact[],
  unassignedFacts: ExtractedFact[],
  language: SupportedLanguage,
  onSection?: (id: string, title: string, content: string) => void,
  ctx?: UsageContext,
): Promise<{ contents: Record<string, string>; inputTokens: number; outputTokens: number }> {
  const systemPrompt = buildHaikuSystemPrompt(language);
  const userMessage = buildHaikuUserMessage(
    sections,
    factAssignment,
    sectionContexts,
    undistributedFindings,
    unassignedFacts,
  );

  const sectionIdSet = new Set(sections.map((s) => s.id));
  const sectionLabels: Record<string, string> = {};
  for (const s of sections) sectionLabels[s.id] = s.label;

  const startTime = Date.now();
  let accumulated = "";
  const emittedSections = new Set<string>();

  const stream = anthropic().messages.stream({
    model: HAIKU_MODEL,
    max_tokens: 4096,
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
    `[section-renderer] Haiku batch — ${elapsed}ms, tokens: ${finalMessage.usage.input_tokens} in / ${finalMessage.usage.output_tokens} out`,
  );

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "anthropic",
      model: HAIKU_MODEL,
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
    const value = parsed[s.id];
    contents[s.id] = typeof value === "string" ? value : "";
  }

  return {
    contents,
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
  };
}

// ---------------------------------------------------------------------------
// Opus narrative call
// ---------------------------------------------------------------------------

async function renderWithOpus(
  sections: SectionTier[],
  factAssignment: Record<string, ExtractedFact[]>,
  sectionContexts: Record<string, string>,
  language: SupportedLanguage,
  options: {
    medicationContext?: string;
    diagnosisContext?: string;
    doctorNotes?: string;
    fileTexts?: { name: string; type: string; text: string; context?: string }[];
    visitDate?: string;
    styleGuide?: string;
    templateSpecialty?: string;
    clinicalAnalysis?: ClinicalAnalysis;
    onSection?: (id: string, title: string, content: string) => void;
  },
  ctx?: UsageContext,
): Promise<{ contents: Record<string, string>; inputTokens: number; outputTokens: number }> {
  const systemPrompt = buildOpusSystemPrompt(
    language,
    options.clinicalAnalysis,
    options.templateSpecialty,
    options.styleGuide,
  );
  const userMessage = buildOpusUserMessage(sections, factAssignment, sectionContexts, {
    medicationContext: options.medicationContext,
    diagnosisContext: options.diagnosisContext,
    doctorNotes: options.doctorNotes,
    fileTexts: options.fileTexts,
    visitDate: options.visitDate,
  });

  const sectionIdSet = new Set(sections.map((s) => s.id));
  const sectionLabels: Record<string, string> = {};
  for (const s of sections) sectionLabels[s.id] = s.label;

  const startTime = Date.now();
  let accumulated = "";
  const emittedSections = new Set<string>();

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
        emittedSections,
        sectionLabels,
        options.onSection,
      );
    }
  });

  const finalMessage = await stream.finalMessage();

  const elapsed = Date.now() - startTime;
  logger.debug(
    `[section-renderer] Opus narrative — ${elapsed}ms, tokens: ${finalMessage.usage.input_tokens} in / ${finalMessage.usage.output_tokens} out`,
  );

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
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
    const value = parsed[s.id];
    contents[s.id] = typeof value === "string" ? value : "";
  }

  return {
    contents,
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect IDs of template sections that have subsections.
 * Reused from anthropic.ts — duplicated here to avoid circular imports.
 */
function collectParentSectionIdsFromTemplate(
  sections: TemplateSection[],
): Set<string> {
  const parents = new Set<string>();
  function walk(list: TemplateSection[]) {
    for (const section of list) {
      if (section.subsections && section.subsections.length > 0) {
        parents.add(section.id);
        walk(section.subsections);
      }
    }
  }
  walk(sections);
  return parents;
}
