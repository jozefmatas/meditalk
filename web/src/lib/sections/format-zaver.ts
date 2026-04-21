/**
 * Deterministic formatter: ICD-code suggestions → Záver section content.
 *
 * The old flow had a Záver LLM agent that drifted (spurious parens,
 * wrong subcodes, missing entries). The new flow takes the suggester's
 * output — already CSV-validated, ranked by relevance, with optional
 * differential clauses for symptom-code primaries — and formats it
 * directly as the Záver section. Single source of truth; zero drift.
 */
import type { SuggestedIcdCode } from "./suggest-icd";

interface FormatOptions {
  /** Max entries to include in Záver. Low-confidence codes are dropped
   *  before this cap applies. Defaults to 10 — plenty for any realistic
   *  encounter, short enough to scan. */
  max?: number;
}

/**
 * Build the Záver line from suggester output.
 *
 *   Primary first: `R07.4 Bolesť v hrudníku (diferenciálna dg.: NSTEMI)`
 *   Secondaries comma-joined: `I10 Primárna [esenciálna] …, K57.3 Divertikulóza …`
 *   Final period.
 *
 * Empty input (or all-low-confidence) → empty string so the Záver
 * section is hidden by the skipEmpty HTML renderer.
 */
export function formatZaverFromSuggestions(
  codes: SuggestedIcdCode[],
  opts?: FormatOptions,
): string {
  const max = opts?.max ?? 10;
  const chosen = codes.filter((c) => c.confidence !== "low").slice(0, max);
  if (chosen.length === 0) return "";

  const primary = chosen[0];
  const primaryStr = primary.differential
    ? `${primary.code} ${primary.description} (diferenciálna dg.: ${primary.differential})`
    : `${primary.code} ${primary.description}`;
  const secondaries = chosen.slice(1).map((c) => `${c.code} ${c.description}`);
  const line = [primaryStr, ...secondaries].join(", ");
  return line.endsWith(".") ? line : `${line}.`;
}
