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
import type { RawSource } from "../section-agent";

/** Post-render hook: takes the section text + raw source, returns corrected text. */
export type Reconciler = (text: string, source: RawSource) => string;

export const RECONCILERS: Record<string, Reconciler> = {
  // Intentionally empty — helpers land here as we need them.
  // First candidates (from the user's notes): drug-normalizer, icd-validator, bp-sanity.
};

export type ReconcilerName = keyof typeof RECONCILERS;
