/**
 * icd-validator reconciler.
 *
 * Runs on Záver / Assessment sections after the agent produces text.
 * For each line whose first token looks like an ICD-10 code, we:
 *
 *   1. Normalize the code format — "R074" → "R07.4", "I213" → "I21.3".
 *   2. Look it up in the locale's ICD-10 CSV via `getIcdDescription`.
 *   3. If found, replace the agent's description with the canonical one.
 *      This prevents Haiku/Sonnet from paraphrasing or abbreviating the
 *      official description (e.g. "Bolesť v hrudi, neurčená" instead of
 *      "Bolesť v hrudníku, bližšie neurčená").
 *   4. If not found, keep the agent's line untouched — the doctor may
 *      have written a code the CSV doesn't know yet.
 *
 * Preserves all text before the code (bullets, headings, prefixes) and
 * all text after the description (additional notes, differential clauses).
 */
import type { Reconciler } from "./index";
import { getIcdDescription } from "../../lookup/icd";

// Matches an ICD code anywhere in a line:
//   "I21.4 Akútny…"       → code = "I21.4"
//   "- I10 Esenciálna…"   → code = "I10"
//   "R074 Bolesť…"        → code = "R074" (will normalize to R07.4)
// Groups: (bullet/indent prefix)(code)(whitespace)(rest of line)
const CODE_LINE_RE =
  /^(\s*[-•*]?\s*)([A-Z]\d{2,4}(?:\.\d{1,4})?)(\s+)([^\n]+)/gm;

/** "R074" → "R07.4"; "I21" → "I21"; "I21.4" → "I21.4". */
function normalizeCode(raw: string): string {
  if (raw.includes(".")) return raw;
  if (raw.length <= 3) return raw;
  return raw.substring(0, 3) + "." + raw.substring(3);
}

export const icdValidator: Reconciler = (text, _source, ctx) => {
  if (!text.trim()) return text;
  const locale = ctx.language;

  return text.replace(
    CODE_LINE_RE,
    (_match, prefix: string, rawCode: string, gap: string, rest: string) => {
      const code = normalizeCode(rawCode);
      const canonical = getIcdDescription(code, locale);
      if (canonical) {
        return `${prefix}${code}${gap}${canonical}`;
      }
      // Code unknown to the CSV — keep the agent's description but still
      // emit the normalized code (R074 → R07.4) so downstream parsing is
      // consistent.
      return `${prefix}${code}${gap}${rest}`;
    },
  );
};
