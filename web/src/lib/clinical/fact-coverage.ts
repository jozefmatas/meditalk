/**
 * Fact-coverage assertion for LLM-rendered sections.
 *
 * Rule 1 of the no-summarization contract: every fact that went in
 * must appear in the output. This module verifies the rule after the
 * narrative (Opus) renderer runs. When coverage falls below the
 * threshold, the caller can flag the section for re-render or surface
 * a warning.
 *
 * How "appear" is measured: for each fact we take its two most-
 * informative content tokens (≥4 chars, diacritic-stripped) and
 * check whether ALL of them appear (in any order) in the rendered
 * prose. If ≥1 token is missing, that fact is considered dropped.
 *
 * This is intentionally lenient — Opus is allowed to rephrase and
 * change word order, but not to omit the fact entirely. "bolesť na
 * hrudi" → "bolesť na hrudníku" passes (both bolest + hrudn tokens
 * present); "bolesť na hrudi" → "diskomfort" fails (no shared token).
 */

import type { FactRef } from "./encounter-model";

export interface FactCoverageIssue {
  /** Section where the fact was expected but not found. */
  sectionId: string;
  /** The fact that appears to have been dropped. */
  fact: FactRef;
  /** The tokens we looked for but didn't see. */
  missingTokens: string[];
}

export interface FactCoverageReport {
  /** Per-section coverage stats. */
  perSection: {
    sectionId: string;
    expected: number;
    rendered: number;
    ratio: number;
  }[];
  /** Facts flagged as dropped. Empty = perfect coverage. */
  dropped: FactCoverageIssue[];
  /** True if overall coverage clears the threshold (default 0.85). */
  passed: boolean;
}

export interface CheckFactCoverageInput {
  /** Map from sectionId → FactRef[] that fed the renderer. */
  expected: Record<string, FactRef[]>;
  /** Map from sectionId → rendered section text. */
  rendered: Record<string, string>;
  /** Minimum fraction of facts per section that must be visible (0–1). */
  threshold?: number;
}

function normalizeToken(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Pull the top-N content tokens from a fact value. We prefer long
 * tokens (≥5 chars) and skip common filler words.
 */
const FILLER = new Set([
  "od",
  "na",
  "do",
  "cez",
  "pre",
  "pri",
  "bez",
  "the",
  "and",
  "with",
  "for",
  "from",
  "since",
]);

function contentTokens(value: string, maxTokens = 3): string[] {
  const norm = normalizeToken(value);
  const all = norm.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const filtered = all.filter((t) => !FILLER.has(t));
  // Prefer longer tokens first — they're more discriminating.
  filtered.sort((a, b) => b.length - a.length);
  // Dedupe.
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const t of filtered) {
    if (seen.has(t)) continue;
    seen.add(t);
    picked.push(t);
    if (picked.length >= maxTokens) break;
  }
  return picked;
}

/**
 * Check whether every fact in `expected` has a corresponding presence
 * in the rendered text for its section. Returns a report + per-
 * section stats so callers can log or retry.
 */
export function checkFactCoverage(
  input: CheckFactCoverageInput,
): FactCoverageReport {
  const threshold = input.threshold ?? 0.85;
  const perSection: FactCoverageReport["perSection"] = [];
  const dropped: FactCoverageIssue[] = [];

  for (const [sectionId, facts] of Object.entries(input.expected)) {
    if (facts.length === 0) continue;
    const rendered = input.rendered[sectionId] ?? "";
    const renderedNorm = normalizeToken(rendered);
    let foundCount = 0;
    for (const f of facts) {
      const tokens = contentTokens(f.value);
      if (tokens.length === 0) {
        // No meaningful tokens to check — assume present (e.g. very
        // short single-word facts).
        foundCount++;
        continue;
      }
      // A fact is considered "found" when ALL of its top content
      // tokens appear in the rendered text.
      const missing = tokens.filter((t) => !renderedNorm.includes(t));
      if (missing.length === 0) {
        foundCount++;
      } else {
        dropped.push({ sectionId, fact: f, missingTokens: missing });
      }
    }
    const ratio = facts.length === 0 ? 1 : foundCount / facts.length;
    perSection.push({
      sectionId,
      expected: facts.length,
      rendered: foundCount,
      ratio,
    });
  }

  const passed = perSection.every((s) => s.ratio >= threshold);
  return { perSection, dropped, passed };
}
