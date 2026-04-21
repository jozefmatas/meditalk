/**
 * Reconciler registry.
 *
 * A reconciler is a small, pure TypeScript helper that post-processes a
 * section's rendered text — e.g. normalizing drug names, validating ICD
 * codes against the CSV, sanity-checking BP/HR ranges.
 *
 * Sections reference reconcilers by string key (stored alongside the
 * section's `context` in the template). This keeps section config purely
 * declarative while letting us add/remove quality checks in code.
 */
import type { Language, RawSource } from "../section-agent";
import { drugNormalizer } from "./drug-normalizer";

export interface ReconcilerContext {
  language: Language;
}

/** Post-render hook: takes the section text + raw source + context, returns corrected text. */
export type Reconciler = (
  text: string,
  source: RawSource,
  ctx: ReconcilerContext,
) => string;

export const RECONCILERS: Record<string, Reconciler> = {
  "drug-normalizer": drugNormalizer,
  // Next candidates: icd-validator, bp-sanity, sat-sanity.
};

export type ReconcilerName = keyof typeof RECONCILERS;
