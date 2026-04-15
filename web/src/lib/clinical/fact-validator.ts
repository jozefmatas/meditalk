import type {
  ExtractedFact,
  ExtractedFacts,
  FactCategory,
  FactExtractionInput,
} from "./fact-extraction";
import { FACT_CATEGORIES, emptyExtractedFacts } from "./fact-extraction";
import type { SupportedLanguage } from "../types";
import type { ClinicalAnalysis } from "./types";
import { isValidMedication, correctMedicationName } from "./medication-index";
import { logger } from "@/lib/logger";

/**
 * Programmatic fact validator — Pass 1.5½.
 *
 * After Haiku emits raw extracted facts, we enforce the grounding contract
 * before handing the set to Opus. Any fact whose evidence quote cannot be
 * found in the referenced source is dropped. Duplicates are collapsed.
 * Unknown medications are kept (to surface the doctor's actual wording) but
 * logged as warnings. Cross-checks against the Pass 1 clinical analysis add
 * context but never add new facts — the validator only removes or warns.
 */

/** Reason a fact was removed by the validator. */
export type RemovalReason =
  | "evidence_not_in_source"
  | "source_index_out_of_range"
  | "duplicate"
  | "empty_value";

export interface RemovedFact {
  fact: ExtractedFact;
  reason: RemovalReason;
  detail?: string;
}

export interface ValidationResult {
  validFacts: ExtractedFacts;
  removedFacts: RemovedFact[];
  warnings: string[];
  counts: {
    total: number;
    removed: number;
    /**
     * Facts that were accepted only after the cross-source fallback fired,
     * i.e. the LLM's claimed source was wrong but the evidence existed in
     * some other source. Useful for telemetry — a high value means the
     * source-type labeling is unreliable.
     */
    recoveredByFallback: number;
  };
}

/**
 * A single source candidate for the cross-source fallback lookup. We iterate
 * through every piece of source material the fact extractor was given and
 * try to find the evidence quote in each one.
 */
interface SourceCandidate {
  type: "transcript" | "doctor_notes" | "file";
  sourceIndex: number;
  text: string;
}

/**
 * Flatten every source in the input into a uniform candidate list so the
 * validator can search across all of them when the LLM's claimed source
 * reference is wrong (e.g. an audio file transcribed to text ends up in
 * `files` but the LLM labels its facts as `type: "transcript"` because
 * the content looks like dialog).
 */
function buildSourceCandidates(input: FactExtractionInput): SourceCandidate[] {
  const candidates: SourceCandidate[] = [];
  input.chunks.forEach((text, i) => {
    if (text) candidates.push({ type: "transcript", sourceIndex: i, text });
  });
  if (input.files) {
    input.files.forEach((f, i) => {
      if (f.text)
        candidates.push({ type: "file", sourceIndex: i, text: f.text });
    });
  }
  if (input.doctorNotes && input.doctorNotes.trim()) {
    candidates.push({
      type: "doctor_notes",
      sourceIndex: 0,
      text: input.doctorNotes,
    });
  }
  return candidates;
}

/**
 * Normalize a string for lexical matching:
 * - Unicode NFKD + strip combining marks (so "ť" ≈ "t")
 * - Lowercase
 * - Collapse any run of non-alphanumerics into a single space
 * - Trim
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Fuzzy-contains check: does the evidence quote appear inside the source?
 *
 * - First pass: normalized substring match.
 * - Second pass: every content token (≥3 chars) from the evidence must
 *   appear in the source in the same order (allows minor interstitial
 *   words or punctuation the model re-flowed).
 */
export function evidenceAppearsInSource(
  evidence: string,
  source: string,
): boolean {
  const normSource = normalizeForMatch(source);
  const normEvidence = normalizeForMatch(evidence);
  if (!normEvidence) return false;
  if (!normSource) return false;
  if (normSource.includes(normEvidence)) return true;

  const tokens = normEvidence.split(" ").filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;

  let cursor = 0;
  for (const token of tokens) {
    const found = normSource.indexOf(token, cursor);
    if (found === -1) return false;
    cursor = found + token.length;
  }
  return true;
}

/**
 * Validate the raw Haiku fact output against its source material.
 *
 * Returns a new `validFacts` object (the input is never mutated) plus a
 * list of removed facts and warnings for telemetry.
 */
export function validateFacts(
  facts: ExtractedFacts,
  input: FactExtractionInput,
  options: {
    pass1?: ClinicalAnalysis | null;
    locale?: SupportedLanguage;
  } = {},
): ValidationResult {
  const removed: RemovedFact[] = [];
  const warnings: string[] = [];
  const validFacts = emptyExtractedFacts();
  validFacts.usage = facts.usage;

  const totalBefore = countFacts(facts);
  // Pre-computed list of every source text for the cross-source fallback.
  // When the LLM misreports `type`/`sourceIndex` (common when an audio file
  // is transcribed and looks like dialog even though it was passed as a
  // "file"), we search the evidence against every source before dropping
  // the fact.
  const allSources = buildSourceCandidates(input);
  let recoveredByFallback = 0;

  for (const category of FACT_CATEGORIES) {
    const seen = new Set<string>();
    for (const fact of facts[category]) {
      if (!fact.value.trim()) {
        removed.push({ fact, reason: "empty_value" });
        continue;
      }

      // 1. Try the LLM's claimed source first — this is the happy path.
      const claimedSourceText = resolveSourceText(fact, input);
      let matched =
        claimedSourceText !== null &&
        evidenceAppearsInSource(fact.source.evidence, claimedSourceText);
      let acceptedFact: ExtractedFact = fact;

      // 2. Cross-source fallback — if the claimed source didn't match (or
      //    doesn't exist), try every other source. This rescues facts the
      //    LLM mislabeled but which ARE grounded somewhere in the input.
      if (!matched) {
        for (const candidate of allSources) {
          // Skip the already-tested claimed source to avoid double work.
          if (
            candidate.type === fact.source.type &&
            candidate.sourceIndex === fact.source.sourceIndex
          ) {
            continue;
          }
          if (evidenceAppearsInSource(fact.source.evidence, candidate.text)) {
            matched = true;
            recoveredByFallback++;
            // Rewrite the source reference to the one we actually found it
            // in so downstream consumers see consistent metadata.
            acceptedFact = {
              ...fact,
              source: {
                ...fact.source,
                type: candidate.type,
                sourceIndex: candidate.sourceIndex,
              },
            };
            break;
          }
        }
      }

      if (!matched) {
        // Neither the claimed source nor any fallback source contains the
        // evidence. Use the most informative reason: "out of range" when
        // the claimed source never existed, otherwise "not in source".
        if (claimedSourceText === null) {
          removed.push({
            fact,
            reason: "source_index_out_of_range",
            detail: `type=${fact.source.type} sourceIndex=${fact.source.sourceIndex}`,
          });
        } else {
          removed.push({
            fact,
            reason: "evidence_not_in_source",
            detail: fact.source.evidence.slice(0, 80),
          });
        }
        continue;
      }

      // 3. Dedup by normalized value within category.
      const key = normalizeForMatch(acceptedFact.value);
      if (seen.has(key)) {
        removed.push({ fact: acceptedFact, reason: "duplicate" });
        continue;
      }
      seen.add(key);

      // 4. Category-specific: auto-correct misspelled medications.
      // Transcription often misspells drug names (e.g. "Koprenesa" for
      // "Co-Prenessa"). If the name isn't in the approved list, try
      // fuzzy matching and auto-correct if a confident match is found.
      if (category === "medications" && options.locale) {
        const locale = options.locale;
        if (!isValidMedication(acceptedFact.value, locale)) {
          const correction = correctMedicationName(acceptedFact.value, locale);
          if (correction) {
            const original = acceptedFact.value;
            acceptedFact.value = correction.correctedName;
            logger.info(
              `[fact-validator] Auto-corrected medication: "${original}" → "${correction.correctedName}" (${correction.entry.activeIngredient})`,
            );
            warnings.push(
              `Medication auto-corrected: "${original}" → "${correction.correctedName}" (${correction.entry.activeIngredient})`,
            );
          } else {
            warnings.push(
              `Medication "${acceptedFact.value}" not found in ${locale} approved list — no close match found`,
            );
          }
        }
      }

      validFacts[category].push(acceptedFact);
    }
  }

  if (removed.length > 0) {
    logger.debug(
      `[fact-validator] removed ${removed.length}/${totalBefore} facts`,
      removed.slice(0, 10).map((r) => ({
        reason: r.reason,
        category: r.fact.category,
        value: r.fact.value,
        detail: r.detail,
      })),
    );
  }

  if (recoveredByFallback > 0) {
    logger.debug(
      `[fact-validator] recovered ${recoveredByFallback} fact(s) via cross-source fallback (LLM mislabeled source)`,
    );
  }

  return {
    validFacts,
    removedFacts: removed,
    warnings,
    counts: {
      total: countFacts(validFacts),
      removed: removed.length,
      recoveredByFallback,
    },
  };
}

/** Resolve the source text a fact's `source` reference points at. */
function resolveSourceText(
  fact: ExtractedFact,
  input: FactExtractionInput,
): string | null {
  const { type, sourceIndex } = fact.source;
  if (type === "transcript") {
    return input.chunks[sourceIndex] ?? null;
  }
  if (type === "doctor_notes") {
    if (sourceIndex !== 0) return null;
    return input.doctorNotes ?? null;
  }
  if (type === "file") {
    const file = input.files?.[sourceIndex];
    return file?.text ?? null;
  }
  return null;
}

/** Count facts across all categories (ignores `usage`). */
export function countFacts(facts: ExtractedFacts): number {
  return FACT_CATEGORIES.reduce((sum, key) => sum + facts[key].length, 0);
}

/**
 * Render validated facts as a structured bullet list for inclusion in the
 * Opus user message. The format is deliberately terse — one bullet per
 * fact, grouped by category — so Opus treats it as a factual contract
 * rather than prose to paraphrase.
 */
export function formatFactsForPrompt(facts: ExtractedFacts): string {
  const lines: string[] = [];
  for (const category of FACT_CATEGORIES) {
    const list = facts[category];
    if (list.length === 0) continue;
    lines.push(`${categoryLabel(category)}:`);
    for (const f of list) {
      lines.push(`  - ${f.value}`);
    }
  }
  return lines.join("\n");
}

function categoryLabel(category: FactCategory): string {
  switch (category) {
    case "chiefComplaint":
      return "Chief Complaint";
    case "demographics":
      return "Demographics";
    case "symptoms":
      return "Symptoms";
    case "findings":
      return "Findings";
    case "measurements":
      return "Measurements";
    case "diagnoses":
      return "Diagnoses";
    case "medications":
      return "Medications → section LA/Meds";
    case "procedures":
      return "Procedures";
    case "familyHistory":
      return "Family History → section RA";
    case "personalHistory":
      return "Personal History → section OA";
    case "socialHistory":
      return "Social History → section SA (NOT substance use, NOT work)";
    case "workHistory":
      return "Work History → section PA (NOT substance use)";
    case "substanceUse":
      return "Substance Use → section Ab (smoking, alcohol, drugs)";
    case "epidemiologicalHistory":
      return "Epidemiological History → section EA";
    case "plan":
      return "Plan";
  }
}
