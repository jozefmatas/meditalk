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

/** "R074" → "R07.4"; "I21" → "I21"; "I21.4" → "I21.4". */
function normalizeCode(raw: string): string {
  if (raw.includes(".")) return raw;
  if (raw.length <= 3) return raw;
  return raw.substring(0, 3) + "." + raw.substring(3);
}

// Splits the text into "entry chunks" — the content between commas and
// newlines that could hold one "CODE Description" pair. Parenthetical
// differential clauses are kept intact (commas INSIDE parens don't split
// the entry).
function splitIntoEntries(text: string): Array<{
  start: number;
  end: number;
  text: string;
}> {
  const entries: Array<{ start: number; end: number; text: string }> = [];
  let depth = 0;
  let chunkStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === "," || ch === "\n")) {
      entries.push({
        start: chunkStart,
        end: i,
        text: text.substring(chunkStart, i),
      });
      chunkStart = i + 1;
    }
  }
  if (chunkStart < text.length) {
    entries.push({
      start: chunkStart,
      end: text.length,
      text: text.substring(chunkStart),
    });
  }
  return entries;
}

// Matches the "CODE Description" pattern at the START of a single entry
// (after any leading whitespace or bullet marker).
const ENTRY_CODE_RE =
  /^(\s*[-•*]?\s*)([A-Z]\d{2,4}(?:\.\d{1,4})?)(\s+)([^\n]+?)$/;

export const icdValidator: Reconciler = (text, _source, ctx) => {
  if (!text.trim()) return text;
  const locale = ctx.language;

  const entries = splitIntoEntries(text);
  let rebuilt = "";
  let cursor = 0;

  for (const entry of entries) {
    // Copy any separator characters between the previous entry and this one.
    rebuilt += text.substring(cursor, entry.start);

    const m = entry.text.match(ENTRY_CODE_RE);
    if (m) {
      const [, prefix, rawCode, gap, rest] = m;
      const code = normalizeCode(rawCode);
      const canonical = getIcdDescription(code, locale);
      if (canonical) {
        // Preserve any trailing parenthetical from the agent's description
        // (e.g. "(diferenciálna dg.: …)") — it's clinical context the CSV
        // canonical doesn't carry.
        const parenMatch = rest.match(/\s*\([^()]*\)\s*$/);
        const trailingParen = parenMatch ? parenMatch[0] : "";
        rebuilt += `${prefix}${code}${gap}${canonical}${trailingParen}`;
      } else {
        rebuilt += `${prefix}${code}${gap}${rest}`;
      }
    } else {
      rebuilt += entry.text;
    }

    cursor = entry.end;
  }

  // Append any trailing separator characters after the last entry.
  rebuilt += text.substring(cursor);

  return rebuilt;
};
