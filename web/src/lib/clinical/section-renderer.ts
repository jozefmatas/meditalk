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
import { classifySection, type SectionRole } from "./section-routing-validator";
import { parseMeasurement, type MeasurementKind } from "./numeric-sanity";
import {
  extractNarrativeEvidence,
  formatNarrativeEvidence,
} from "./narrative-evidence";
import type { EncounterModel } from "./encounter-model";
import { renderObjectiveSection } from "./renderers/objective";
import {
  renderAllergiesSection,
  renderHabitsSection,
  renderFamilyHistorySection,
  renderPersonalHistorySection,
  renderSocialHistorySection,
  renderEpidemiologicalSection,
  renderMedicationsSection,
} from "./renderers/history";
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
  // Structured exam subsections — rendered directly from facts, zero drift.
  vitals: "deterministic",
  ekg: "deterministic",
  labs: "deterministic",
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
  // Defensive category filter — only emit `medications` facts. The
  // fact-section-assigner can occasionally route non-medication facts
  // (e.g. chiefComplaint) into a medications-role section when the
  // section's context mentions overlapping keywords; without this
  // filter we'd render HPI prose as a medication list.
  //
  // Negated medications ("patient denies warfarin") are not currently
  // taken — they don't belong in the LA list either. Skip them.
  const affirmed = facts.filter(
    (f) => !f.negated && f.category === "medications",
  );
  if (affirmed.length === 0) return "";
  return affirmed.map((f) => f.value).join(", ");
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

/**
 * Detect the measurement kind referenced by a section label.
 *
 * Specific subsections ("Krvný tlak", "Saturácia") map to a single
 * kind; generic labels ("Vitálne funkcie", "Vital signs") return
 * `null` which tells the caller to include all vital measurement
 * kinds for that section.
 */
export function detectVitalsKindFromLabel(
  label: string,
): MeasurementKind | null {
  // Strip diacritics so "Krvný tlak" matches the plain-ASCII pattern.
  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/krvny tlak|blood pressure|\btk\b|\bbp\b/.test(normalized)) return "bp";
  if (/srdcov|pulse|\btep\b|\bsf\b|\bhr\b/.test(normalized)) return "hr";
  if (/dychov|respirator|\bdf\b|\brr\b/.test(normalized)) return "rr";
  if (/saturac|spo\s*2|o2\s*sat/.test(normalized)) return "spo2";
  if (/teplot|temperature|\btt\b/.test(normalized)) return "temp_c";
  if (/glykemi|glycem|glucose/.test(normalized)) return "glucose_mmol";
  if (/\bgcs\b/.test(normalized)) return "gcs";
  return null; // generic vitals section — keep all kinds
}

/** Kinds we consider "vital signs" for generic-vitals-section rendering. */
const VITAL_KINDS: readonly MeasurementKind[] = [
  "bp",
  "hr",
  "rr",
  "spo2",
  "temp_c",
  "gcs",
];

/** Kinds we consider "labs" for a generic labs section (no narrative lab findings yet). */
const LAB_KINDS: readonly MeasurementKind[] = ["glucose_mmol", "glucose_mgdl"];

/**
 * True when `fact`'s value parses to a measurement of one of the given
 * kinds AND the fact is affirmed. Negated measurement facts are skipped
 * because the deterministic renderers would emit the value verbatim
 * (losing the negation), which is clinically unsafe — a negated vital
 * is handled by the prose-rendering tiers instead.
 *
 * Category is also checked: only `measurements`-category facts can land
 * in vitals/labs sections — prevents mis-routed non-measurement facts
 * from leaking into a structured block.
 */
function factMatchesKinds(
  fact: ExtractedFact,
  kinds: readonly MeasurementKind[],
): boolean {
  if (fact.negated) return false;
  if (fact.category !== "measurements") return false;
  const parsed = parseMeasurement(fact.value);
  if (!parsed) return false;
  return kinds.includes(parsed.kind);
}

/**
 * Render a vitals subsection deterministically. Picks matching facts from
 * the supplied pool (either the section's own assignment or the parent's
 * undistributed pool) and emits one fact per line, preserving the exact
 * fact value (which already carries units + timestamp).
 *
 * If `kind` is null the section is treated as a generic vitals section
 * (e.g. "Vitálne funkcie") and ALL vital-kind measurements are included.
 */
export function renderVitals(
  facts: ExtractedFact[],
  kind: MeasurementKind | null,
): { text: string; consumed: ExtractedFact[] } {
  const targetKinds = kind ? [kind] : VITAL_KINDS;
  const consumed = facts.filter((f) => factMatchesKinds(f, targetKinds));
  if (consumed.length === 0) return { text: "", consumed: [] };
  return { text: consumed.map((f) => f.value).join("\n"), consumed };
}

/**
 * Render a labs subsection deterministically. Consumes measurement facts
 * whose kind is in `LAB_KINDS` (currently glucose variants — labs that
 * arrive as numeric measurements). Narrative lab findings (troponin, CRP,
 * etc.) are still routed through Haiku until a structured lab fact
 * category exists.
 */
export function renderLabs(facts: ExtractedFact[]): {
  text: string;
  consumed: ExtractedFact[];
} {
  const consumed = facts.filter((f) => factMatchesKinds(f, LAB_KINDS));
  if (consumed.length === 0) return { text: "", consumed: [] };
  return { text: consumed.map((f) => f.value).join("\n"), consumed };
}

/**
 * Detect EKG-related facts. Matches any fact (finding or measurement)
 * whose value contains EKG/ECG/rhythm/ST/QRS keywords.
 */
const EKG_KEYWORD_REGEX =
  /\bekg\b|\becg\b|elektrokardio|electrocardio|\brytmus\b|\brhythm\b|\bsr\b\s|\bsf\b|\bst\b\s*(?:elevac|depres|elevat|depres)|\bqrs\b/i;

function factLooksLikeEkg(fact: ExtractedFact): boolean {
  // Same rationale as `factMatchesKinds`: deterministic renderer emits
  // the value verbatim, which would misrepresent a negated EKG finding
  // ("no ST elevation" rendered as "ST elevation"). Skip negated facts
  // — the prose-rendering tier handles them.
  if (fact.negated) return false;
  // EKG facts live in `findings` or `measurements` in practice. Anything
  // else (e.g. a symptom fact that happens to mention "EKG") shouldn't
  // leak into the deterministic EKG section.
  if (fact.category !== "findings" && fact.category !== "measurements") {
    return false;
  }
  return EKG_KEYWORD_REGEX.test(fact.value);
}

/**
 * Render an EKG subsection deterministically. Picks facts that look like
 * EKG findings (rhythm, ST changes, QRS descriptors). Emits them one per
 * line, preserving the fact value verbatim.
 */
export function renderEkg(facts: ExtractedFact[]): {
  text: string;
  consumed: ExtractedFact[];
} {
  const consumed = facts.filter(factLooksLikeEkg);
  if (consumed.length === 0) return { text: "", consumed: [] };
  return { text: consumed.map((f) => f.value).join("\n"), consumed };
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
9. NEGATED FACTS: a fact prefixed with "[NEGATED]" documents the ABSENCE of the finding (pertinent negative). Render it as a negation in natural ${LANGUAGE_LABELS[language]}, appropriate to the section and grammar:
   - Slovak: "bez <genitív>", "neguje <akuzatív>", "neudáva <akuzatív>" (whichever flows best)
   - Czech: "bez <genitiv>", "neguje <akuzativ>", "neudává <akuzativ>"
   - English: "no <noun>", "denies <noun>", "no evidence of <noun>"
   Never emit the literal string "[NEGATED]" in the output. Keep the negated fact in the SAME section as affirmed facts of that category (don't split into a separate "negatives" block unless the template explicitly asks for one).

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

  const renderFact = (f: ExtractedFact): string =>
    `  - ${f.negated ? "[NEGATED] " : ""}${f.value}`;

  for (const section of sections) {
    const facts = factAssignment[section.id] ?? [];
    const context = sectionContexts[section.id] ?? "";
    lines.push(`[Section "${section.label}" (${section.id})]:`);
    if (context) lines.push(`  Context: ${context}`);
    if (facts.length === 0) {
      lines.push("  (no facts assigned)");
    } else {
      for (const f of facts) {
        lines.push(renderFact(f));
      }
    }
    lines.push("");
  }

  if (undistributedFindings.length > 0) {
    lines.push(
      "UNDISTRIBUTED FINDINGS (distribute to appropriate subsections above based on their context):",
    );
    for (const f of undistributedFindings) {
      lines.push(renderFact(f));
    }
    lines.push("");
  }

  if (unassignedFacts.length > 0) {
    lines.push("GENERAL CONTEXT (place in most appropriate section above):");
    for (const f of unassignedFacts) {
      lines.push(renderFact(f));
    }
    lines.push("");
  }

  lines.push(
    `Format each section and return valid JSON with keys: ${sections.map((s) => `"${s.id}"`).join(", ")}`,
  );

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
9. NEGATED FACTS: a fact prefixed with "[NEGATED]" documents the ABSENCE of the finding (pertinent negative) — the doctor deliberately recorded that this symptom/finding is NOT present. Render it as a negation in natural ${LANGUAGE_LABELS[language]} that fits the narrative flow (e.g. Slovak "bez dušnosti", "neguje nauzeu"; English "denies dyspnea", "no associated nausea"). Never emit the literal string "[NEGATED]" in the output. Integrate negatives into the narrative — they are as important clinically as positives, especially in the present-illness section.

OUTPUT: Return valid JSON with section IDs as keys and formatted text as values. No markdown, no explanation.`);

  // Add specialty prompt pack if available
  const specialty = (templateSpecialty ??
    clinicalAnalysis?.inferredSpecialty) as SpecialtyId | undefined;
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
    /**
     * Scoped source snippets for narrative texture (e.g. onset phrases,
     * refusal language). Replaces the legacy full `doctorNotes` +
     * `fileTexts` dump. See `narrative-evidence.ts`.
     */
    narrativeEvidence?: string;
    visitDate?: string;
  },
): string {
  const lines: string[] = [];

  if (options?.visitDate) {
    lines.push(`ENCOUNTER DATE: ${options.visitDate}`);
    lines.push(
      'Resolve relative temporal references ("dnes", "včera", "today", "yesterday") relative to this date.',
    );
    lines.push("");
  }

  // Provide medication/diagnosis context for reference (NOT for listing)
  if (options?.medicationContext) {
    lines.push(
      "MEDICATION CONTEXT (reference only — do NOT list these, they have a dedicated section):",
    );
    lines.push(options.medicationContext);
    lines.push("");
  }

  if (options?.diagnosisContext) {
    lines.push(
      "DIAGNOSIS CONTEXT (reference only — do NOT list these, they have a dedicated section):",
    );
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
        lines.push(`  - ${f.negated ? "[NEGATED] " : ""}${f.value}`);
      }
    }
    lines.push("");
  }

  // Narrative evidence — fact-scoped context windows from the original
  // sources. Replaces the legacy full-dump of doctor notes + file texts
  // so Opus sees only the language/texture relevant to the facts it's
  // already been assigned.
  if (options?.narrativeEvidence?.trim()) {
    lines.push(options.narrativeEvidence);
    lines.push("");
  }

  lines.push(
    `Format each section and return valid JSON with keys: ${sections.map((s) => `"${s.id}"`).join(", ")}`,
  );

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
    /**
     * EncounterModel — when supplied, deterministic objective renderers
     * (vitals / labs / EKG / exam) read from `model.objective.*` instead
     * of the legacy `factAssignment` + undistributedPool logic.
     */
    encounterModel?: EncounterModel;
    /**
     * Transcript chunks — used as a source for narrative evidence
     * extraction when Opus needs context beyond the pre-assigned facts.
     */
    chunks?: string[];
    doctorNotes?: string;
    fileTexts?: {
      name: string;
      type: string;
      text: string;
      context?: string;
    }[];
    visitDate?: string;
    styleGuide?: string;
    templateSpecialty?: string;
    onSection?: (id: string, title: string, content: string) => void;
  },
  ctx?: UsageContext,
): Promise<{ sectionContents: Record<string, string>; usage: RenderUsage }> {
  const sectionContexts = options?.sectionContexts ?? {};
  const onSection = options?.onSection;

  // 1. Classify all sections into tiers. When an EncounterModel is
  // supplied, promote history-style roles (allergies, substanceUse,
  // personal/social/work/family/epidemiological) to the deterministic
  // tier — they render directly from `model.history.*` instead of
  // going through Haiku. This is Phase 3 of the refactor.
  const rawTiers = classifySectionTiers(
    sectionLabels,
    options?.sectionContexts,
  );
  const PROMOTABLE_TO_DETERMINISTIC: ReadonlySet<SectionRole> = new Set<
    SectionRole
  >([
    "allergies",
    "substanceUse",
    "personalHistory",
    "socialHistory",
    "epidemiological",
  ]);
  const tiers: SectionTier[] = options?.encounterModel
    ? rawTiers.map((t) =>
        PROMOTABLE_TO_DETERMINISTIC.has(t.role)
          ? { ...t, tier: "deterministic" as const }
          : t,
      )
    : rawTiers;
  const deterministicSections = tiers.filter((t) => t.tier === "deterministic");
  const haikuSections = tiers.filter((t) => t.tier === "haiku");
  const opusSections = tiers.filter((t) => t.tier === "opus");

  const result: Record<string, string> = {};
  const usage: RenderUsage = {
    haiku: { inputTokens: 0, outputTokens: 0 },
    opus: { inputTokens: 0, outputTokens: 0 },
  };

  // 2. Pre-compute the undistributed pool so deterministic vitals/ekg/labs
  //    subsections can consume from it before Haiku sees it. This is the
  //    pool of measurement/finding facts that the assigner routed to a
  //    parent section (e.g. "Objektívne vyšetrenie") rather than a
  //    specific subsection. Haiku normally redistributes them; for
  //    deterministic subsections, we redistribute here.
  const parentIds = collectParentSectionIdsFromTemplate(template.sections);
  const undistributedPool = new Set(
    collectUndistributedFindings(factAssignment, parentIds),
  );
  const unassigned = factAssignment["_unassigned"] ?? [];

  // 3. Render deterministic sections instantly
  for (const section of deterministicSections) {
    if (section.role === "medications") {
      if (options?.encounterModel) {
        result[section.id] = renderMedicationsSection(options.encounterModel);
      } else {
        const medFacts = factAssignment[section.id] ?? [];
        result[section.id] = renderMedications(medFacts);
      }
    } else if (section.role === "allergies" && options?.encounterModel) {
      result[section.id] = renderAllergiesSection(options.encounterModel);
    } else if (section.role === "substanceUse" && options?.encounterModel) {
      result[section.id] = renderHabitsSection(options.encounterModel);
    } else if (section.role === "personalHistory" && options?.encounterModel) {
      result[section.id] = renderPersonalHistorySection(
        options.encounterModel,
      );
    } else if (section.role === "socialHistory" && options?.encounterModel) {
      result[section.id] = renderSocialHistorySection(options.encounterModel);
    } else if (
      section.role === "epidemiological" &&
      options?.encounterModel
    ) {
      result[section.id] = renderEpidemiologicalSection(options.encounterModel);
    } else if (section.role === "assessment") {
      result[section.id] = renderAssessment(options?.icdBlock);
    } else if (section.role === "vitals") {
      // Model-backed: render from `model.objective.vitals`. The model
      // already partitioned facts into vitals vs labs vs exam — no
      // redistribution needed here. Single-vitals-subsection templates
      // ("Krvný tlak" used as catch-all) get all vital kinds because
      // the model's label → kind detection handles the fallback.
      if (options?.encounterModel) {
        let kind = detectVitalsKindFromLabel(section.label);
        if (kind !== null) {
          const hasSiblingVitalsWithOtherKind = deterministicSections.some(
            (s) =>
              s.id !== section.id &&
              s.role === "vitals" &&
              detectVitalsKindFromLabel(s.label) !== kind,
          );
          if (!hasSiblingVitalsWithOtherKind) kind = null;
        }
        const text = renderObjectiveSection(
          options.encounterModel,
          section.role,
          section.label,
        );
        result[section.id] = text ?? "";
        void kind;
      } else {
        // Legacy fallback — retained so non-model callers keep working
        // until Phase 6 deletes this branch.
        const ownFacts = factAssignment[section.id] ?? [];
        const pool =
          ownFacts.length > 0 ? ownFacts : Array.from(undistributedPool);
        let kind = detectVitalsKindFromLabel(section.label);
        if (kind !== null) {
          const hasSiblingVitalsWithOtherKind = deterministicSections.some(
            (s) =>
              s.id !== section.id &&
              s.role === "vitals" &&
              detectVitalsKindFromLabel(s.label) !== kind,
          );
          if (!hasSiblingVitalsWithOtherKind) kind = null;
        }
        const { text, consumed } = renderVitals(pool, kind);
        result[section.id] = text;
        for (const f of consumed) undistributedPool.delete(f);
      }
    } else if (section.role === "ekg") {
      if (options?.encounterModel) {
        const text = renderObjectiveSection(
          options.encounterModel,
          section.role,
          section.label,
        );
        result[section.id] = text ?? "";
      } else {
        const ownFacts = factAssignment[section.id] ?? [];
        const pool =
          ownFacts.length > 0 ? ownFacts : Array.from(undistributedPool);
        const { text, consumed } = renderEkg(pool);
        result[section.id] = text;
        for (const f of consumed) undistributedPool.delete(f);
      }
    } else if (section.role === "labs") {
      if (options?.encounterModel) {
        const text = renderObjectiveSection(
          options.encounterModel,
          section.role,
          section.label,
        );
        result[section.id] = text ?? "";
      } else {
        const ownFacts = factAssignment[section.id] ?? [];
        const pool =
          ownFacts.length > 0 ? ownFacts : Array.from(undistributedPool);
        const { text, consumed } = renderLabs(pool);
        result[section.id] = text;
        for (const f of consumed) undistributedPool.delete(f);
      }
    } else {
      result[section.id] = "";
    }

    // Emit immediately via callback
    if (onSection) {
      onSection(section.id, section.label, result[section.id]);
    }
  }

  // 4. Build medication/diagnosis context for Opus
  const medicationContext = deterministicSections
    .filter((s) => s.role === "medications" && result[s.id])
    .map((s) => result[s.id])
    .join("; ");

  const diagnosisContext = deterministicSections
    .filter((s) => s.role === "assessment" && result[s.id])
    .map((s) => result[s.id])
    .join("\n");

  // Rebuild the undistributed array from whatever remains in the pool
  // after deterministic vitals/ekg/labs have consumed their facts.
  const undistributed = Array.from(undistributedPool);

  // 5. Run Haiku + Opus in parallel
  const haikuPromise =
    haikuSections.length > 0
      ? renderWithHaiku(
          haikuSections,
          factAssignment,
          sectionContexts,
          undistributed,
          unassigned,
          language,
          onSection,
          ctx,
        )
      : Promise.resolve({
          contents: {} as Record<string, string>,
          inputTokens: 0,
          outputTokens: 0,
        });

  // Scope Opus to narrative snippets around the facts already assigned
  // to TO/Plan — replacing the legacy full-dump of doctor notes + files.
  // This is the Strengthen Step 5 tightening.
  const opusFacts: ExtractedFact[] = [];
  for (const section of opusSections) {
    const assigned = factAssignment[section.id] ?? [];
    for (const f of assigned) opusFacts.push(f);
  }
  const narrativeSnippets =
    opusFacts.length > 0
      ? extractNarrativeEvidence(opusFacts, {
          chunks: options?.chunks ?? [],
          doctorNotes: options?.doctorNotes,
          files: options?.fileTexts,
        })
      : [];
  const narrativeEvidence =
    narrativeSnippets.length > 0
      ? formatNarrativeEvidence(narrativeSnippets)
      : undefined;

  const opusPromise =
    opusSections.length > 0
      ? renderWithOpus(
          opusSections,
          factAssignment,
          sectionContexts,
          language,
          {
            medicationContext: medicationContext || undefined,
            diagnosisContext: diagnosisContext || undefined,
            narrativeEvidence,
            visitDate: options?.visitDate,
            styleGuide: options?.styleGuide,
            templateSpecialty: options?.templateSpecialty,
            clinicalAnalysis: options?.clinicalAnalysis,
            onSection,
          },
          ctx,
        )
      : Promise.resolve({
          contents: {} as Record<string, string>,
          inputTokens: 0,
          outputTokens: 0,
        });

  const [haikuResult, opusResult] = await Promise.all([
    haikuPromise,
    opusPromise,
  ]);

  // 6. Merge results
  for (const section of haikuSections) {
    result[section.id] = haikuResult.contents[section.id] ?? "";
  }
  for (const section of opusSections) {
    result[section.id] = opusResult.contents[section.id] ?? "";
  }

  usage.haiku = {
    inputTokens: haikuResult.inputTokens,
    outputTokens: haikuResult.outputTokens,
  };
  usage.opus = {
    inputTokens: opusResult.inputTokens,
    outputTokens: opusResult.outputTokens,
  };

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
): Promise<{
  contents: Record<string, string>;
  inputTokens: number;
  outputTokens: number;
}> {
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
    narrativeEvidence?: string;
    visitDate?: string;
    styleGuide?: string;
    templateSpecialty?: string;
    clinicalAnalysis?: ClinicalAnalysis;
    onSection?: (id: string, title: string, content: string) => void;
  },
  ctx?: UsageContext,
): Promise<{
  contents: Record<string, string>;
  inputTokens: number;
  outputTokens: number;
}> {
  const systemPrompt = buildOpusSystemPrompt(
    language,
    options.clinicalAnalysis,
    options.templateSpecialty,
    options.styleGuide,
  );
  const userMessage = buildOpusUserMessage(
    sections,
    factAssignment,
    sectionContexts,
    {
      medicationContext: options.medicationContext,
      diagnosisContext: options.diagnosisContext,
      narrativeEvidence: options.narrativeEvidence,
      visitDate: options.visitDate,
    },
  );

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
