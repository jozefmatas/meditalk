/**
 * Timeline coherence — Pass 1.6c.
 *
 * Reconciles *implicit* temporal corrections: the doctor says "chest pain
 * since morning" and later refines to "chest pain since 13:00". Both are
 * factual; they describe the same event at different precisions. Keeping
 * both produces a contradictory narrative in TO/HPI. The explicit
 * correction resolver ([fact-resolver.ts](fact-resolver.ts)) only catches
 * verbal corrections ("vlastne", "actually") — it intentionally does not
 * collapse same-subject / different-time pairs, because that would also
 * collapse legitimate time-series.
 *
 * This module only runs on `symptoms` and `chiefComplaint` (the
 * narrative-sensitive categories) and only collapses pairs where:
 *   1. The non-temporal content overlaps significantly (Jaccard ≥ 0.5
 *      on content tokens after stripping the temporal phrase), AND
 *   2. The temporal anchors differ in *precision* — e.g. clock time
 *      ("13:00") vs relative ("od rána"). A more precise anchor
 *      supersedes a less precise one describing the same event.
 *
 * Measurements, findings, medications, and other categories are left
 * alone — time-series there is expected (BP at 14:02, 14:31, 14:58…).
 */

import type {
  ExtractedFact,
  ExtractedFacts,
  FactCategory,
} from "./fact-extraction";
import { FACT_CATEGORIES, emptyExtractedFacts } from "./fact-extraction";
import { normalizeForMatch } from "./fact-validator";

/** How precise a temporal anchor is. Higher = wins a precision comparison. */
export type TemporalKind = "clock" | "relative" | "duration" | "none";

const PRECISION: Record<TemporalKind, number> = {
  clock: 3,
  relative: 2,
  duration: 1,
  none: 0,
};

export interface TemporalAnchor {
  kind: TemporalKind;
  precision: number;
  /** The raw substring matched in the fact value (empty when kind === "none"). */
  raw: string;
}

/** A single dropped pair — the less-precise fact lost to the more precise one. */
export interface TimelineConflict {
  /** The fact that survived (more precise temporal anchor). */
  kept: ExtractedFact;
  /** The fact that was dropped (less precise anchor, same subject). */
  dropped: ExtractedFact;
  /** Jaccard similarity on non-temporal tokens — for debugging / telemetry. */
  subjectSimilarity: number;
  keptAnchor: TemporalAnchor;
  droppedAnchor: TemporalAnchor;
}

/**
 * Only these categories participate in conflict resolution.
 * Everything else (measurements, findings, meds, etc.) can legitimately
 * produce same-subject / different-time pairs that MUST be preserved.
 */
const RESOLVED_CATEGORIES: ReadonlySet<FactCategory> = new Set<FactCategory>([
  "symptoms",
  "chiefComplaint",
]);

// ---------------------------------------------------------------------------
// Temporal anchor extraction
// ---------------------------------------------------------------------------

// Clock times: "14:02", "13.00", "o 13:00", "since 13:00", "od 13:00"
const CLOCK_REGEX = /\b(\d{1,2}[:.]\d{2}(?::\d{2})?)\b/;

// Relative phrases (Slovak / Czech / English) — dawn, morning, afternoon,
// evening, night, yesterday, day before yesterday, today.
const RELATIVE_REGEX =
  /\b(od\s+rána|od\s+rana|od\s+poobeda|od\s+večera|od\s+vecera|od\s+včera|od\s+vcera|predvčerom|predvcerom|od\s+dnes\s+rána|this\s+morning|since\s+morning|since\s+yesterday|this\s+afternoon|tonight|last\s+night|od\s+polud(?:ňa|na)|dnes\s+ráno)\b/i;

// Durations: "3 days", "2 hours", "tri dni", "2 hodiny"
const DURATION_REGEX =
  /\b(\d+|jednu|dve|tri|štyri|päť|šesť|sedem|osem|deväť|desať|one|two|three|four|five|six|seven|eight|nine|ten)\s+(hodín|hodiny|hodinu|hodín|hodín\.|dní|dní\.|dni|týždňov|tyzdnov|mesiacov|minút|minut|hours?|days?|weeks?|months?|minutes?)\b/i;

/**
 * Extract the most precise temporal anchor from a fact value.
 * Returns `{kind: "none", precision: 0, raw: ""}` when no temporal
 * phrase is recognized.
 */
export function extractTemporalAnchor(value: string): TemporalAnchor {
  if (!value) return { kind: "none", precision: 0, raw: "" };

  const clock = value.match(CLOCK_REGEX);
  if (clock) {
    return { kind: "clock", precision: PRECISION.clock, raw: clock[0] };
  }

  const relative = value.match(RELATIVE_REGEX);
  if (relative) {
    return {
      kind: "relative",
      precision: PRECISION.relative,
      raw: relative[0],
    };
  }

  const duration = value.match(DURATION_REGEX);
  if (duration) {
    return {
      kind: "duration",
      precision: PRECISION.duration,
      raw: duration[0],
    };
  }

  return { kind: "none", precision: 0, raw: "" };
}

// ---------------------------------------------------------------------------
// Subject similarity
// ---------------------------------------------------------------------------

/**
 * Tokenize a fact value into content tokens suitable for subject
 * comparison:
 *  - normalize diacritics + case + punctuation,
 *  - strip the detected temporal phrase,
 *  - keep only tokens ≥ 3 characters (drops "na", "a", "v"),
 *  - drop a small stoplist of temporal/descriptive filler words.
 */
const FILLER_TOKENS = new Set([
  "od",
  "uz",
  "potom",
  "stale",
  "dnes",
  "vcera",
  "rano",
  "vecer",
  "since",
  "from",
  "for",
  "ago",
  "still",
  "then",
  "the",
  "and",
  "with",
]);

function contentTokens(value: string, anchorRaw: string): Set<string> {
  let stripped = value;
  if (anchorRaw) {
    stripped = stripped.replace(anchorRaw, " ");
  }
  const normalized = normalizeForMatch(stripped);
  const toks = normalized.split(" ").filter((t) => t.length >= 3);
  const result = new Set<string>();
  for (const t of toks) {
    if (FILLER_TOKENS.has(t)) continue;
    result.add(t);
  }
  return result;
}

/** Jaccard similarity between two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Result of a timeline coherence pass over an `ExtractedFacts` set.
 */
export interface TimelineCoherenceResult {
  /** The facts object with less-precise conflict losers removed. */
  facts: ExtractedFacts;
  /** Every pair the pass collapsed, in insertion order. */
  conflicts: TimelineConflict[];
}

export interface TimelineCoherenceOptions {
  /** Minimum Jaccard similarity to treat two facts as the same subject. */
  similarityThreshold?: number;
}

/**
 * Run the timeline coherence pass over an `ExtractedFacts` set.
 *
 * For each relevant category (`symptoms`, `chiefComplaint`) we scan
 * pairs of facts. When two facts share a subject (Jaccard ≥ threshold)
 * but have different temporal precisions, the less precise one is
 * dropped and a `TimelineConflict` is recorded.
 *
 * Note on "same precision, different anchors" — e.g. two clock-time
 * facts ("13:00" and "14:00") for chest pain: these are NOT collapsed,
 * because they may describe progression (pain started at 13:00 and
 * worsened at 14:00). Only strictly-lower-precision losers are dropped.
 */
export function resolveTimelineCoherence(
  input: ExtractedFacts,
  options: TimelineCoherenceOptions = {},
): TimelineCoherenceResult {
  const threshold = options.similarityThreshold ?? 0.5;
  const result = emptyExtractedFacts();
  result.usage = input.usage;
  const conflicts: TimelineConflict[] = [];

  for (const category of FACT_CATEGORIES) {
    const list = input[category];
    if (!RESOLVED_CATEGORIES.has(category)) {
      result[category] = [...list];
      continue;
    }

    // Annotate each fact with its temporal anchor + token set so we
    // only compute them once per fact.
    const annotated = list.map((fact) => {
      const anchor = extractTemporalAnchor(fact.value);
      return { fact, anchor, tokens: contentTokens(fact.value, anchor.raw) };
    });

    // Mark which indices were dropped; iterate pairs quadratically (the
    // category list is always small — doctors don't produce hundreds of
    // chief-complaint facts).
    const dropped = new Set<number>();
    for (let i = 0; i < annotated.length; i++) {
      if (dropped.has(i)) continue;
      const a = annotated[i];
      for (let j = i + 1; j < annotated.length; j++) {
        if (dropped.has(j)) continue;
        const b = annotated[j];
        const sim = jaccard(a.tokens, b.tokens);
        if (sim < threshold) continue;

        if (a.anchor.precision > b.anchor.precision) {
          dropped.add(j);
          conflicts.push({
            kept: a.fact,
            dropped: b.fact,
            subjectSimilarity: sim,
            keptAnchor: a.anchor,
            droppedAnchor: b.anchor,
          });
        } else if (b.anchor.precision > a.anchor.precision) {
          dropped.add(i);
          conflicts.push({
            kept: b.fact,
            dropped: a.fact,
            subjectSimilarity: sim,
            keptAnchor: b.anchor,
            droppedAnchor: a.anchor,
          });
          break; // `i` is gone, stop comparing it
        }
        // Equal precision → keep both (could be legitimate progression).
      }
    }

    result[category] = annotated
      .filter((_, idx) => !dropped.has(idx))
      .map((a) => a.fact);
  }

  return { facts: result, conflicts };
}
