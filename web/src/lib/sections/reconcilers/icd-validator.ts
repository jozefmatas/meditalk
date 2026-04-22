/**
 * icd-validator reconciler.
 *
 * Runs on Záver / Assessment sections after the agent produces text.
 * Walks entries by CODE BOUNDARY (not by comma) and for each one:
 *
 *   1. Normalize the code — "R074" → "R07.4", "I2101" → "I21.01".
 *   2. Look it up in the locale's ICD-10 CSV via `getIcdDescription`.
 *   3. Decision tree:
 *      - Code in CSV                                    → use canonical description.
 *      - Code NOT in CSV but 3-char root IS in CSV      → downgrade to root + canonical.
 *      - Code NOT in CSV and looks like ICD-10-CM       → drop the entry.
 *      - Code NOT in CSV and looks like valid ICD-10    → keep as-is (rare Slovak code
 *                                                         the CSV may lack).
 *
 * The old splitter broke on commas, which produced "Bolesť v hrudníku,
 * bližšie neurčená, bližšie neurčená" doubling when the CSV canonical
 * contained a comma that survived as its own chunk. Splitting on code
 * boundaries instead means the canonical replaces the WHOLE description,
 * not a fragment.
 */
import type { Reconciler } from "./index";
import { getIcdDescription } from "../../lookup/icd";
import { logger } from "../../logger";

/** "R074" → "R07.4"; "R07.4" → "R07.4"; "I2101" → "I21.01". */
function normalizeCode(raw: string): string {
  if (raw.includes(".")) return raw;
  if (raw.length <= 3) return raw;
  return raw.substring(0, 3) + "." + raw.substring(3);
}

/**
 * ICD-10-CM (US extension) uses 3+ digits after the decimal. WHO/Slovak
 * ICD-10 uses 0-2. When the code is absent from our CSV AND has a long
 * decimal tail, it's almost certainly an ICD-10-CM leak from training
 * data — drop rather than ship something that doesn't resolve.
 */
function isLikelyIcd10Cm(code: string): boolean {
  const decimal = code.split(".")[1] ?? "";
  return decimal.length >= 3;
}

/** Code-shaped token anywhere in the text. */
const CODE_TOKEN_RE = /\b([A-Z])(\d{2,4})(?:\.(\d{1,4}))?\b/g;

/**
 * Find code positions in the text. Each entry spans from one code's
 * first character to just before the next code's first character (or
 * end-of-string for the last entry).
 */
interface EntryBounds {
  /** Index of the code's first character in the original text. */
  codeStart: number;
  /** Index one past the end of the code token. */
  codeEnd: number;
  /** Raw code as matched ("R074" or "R07.4"). */
  rawCode: string;
  /** End of this entry in the original text (next code's codeStart, or text.length). */
  entryEnd: number;
}

function findEntries(text: string): EntryBounds[] {
  const matches: Array<{ start: number; end: number; raw: string }> = [];
  let m: RegExpExecArray | null;
  CODE_TOKEN_RE.lastIndex = 0;
  while ((m = CODE_TOKEN_RE.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  return matches.map((match, i) => ({
    codeStart: match.start,
    codeEnd: match.end,
    rawCode: match.raw,
    entryEnd: i + 1 < matches.length ? matches[i + 1].start : text.length,
  }));
}

/**
 * Pull the trailing parenthetical (`(diferenciálna dg.: …)`) out of a
 * description tail and return {body, paren}. The parenthetical is
 * clinical context the CSV canonical doesn't carry; we keep it.
 */
function splitTrailingParen(tail: string): { body: string; paren: string } {
  const paren = tail.match(/\s*\([^()]*\)\s*$/);
  if (!paren) return { body: tail, paren: "" };
  return {
    body: tail.slice(0, paren.index).trimEnd(),
    paren: paren[0].trim() ? " " + paren[0].trim() : "",
  };
}

/**
 * Some CSV descriptions already end with the same parenthetical the
 * caller is preserving — e.g. `D47.2` canonical is "Monoklonová
 * gamapatia nejasného významu (MGUS)", and the section text also ends
 * with "(MGUS)". Concatenating both yields "… (MGUS) (MGUS)". Drop the
 * author-preserved paren when the canonical already carries the same
 * text (case-insensitive, whitespace-collapsed comparison).
 */
function parenIsRedundant(canonical: string, paren: string): boolean {
  if (!paren) return false;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return norm(canonical).endsWith(norm(paren));
}

/** Strip leading bullet / punctuation so we emit clean entries. */
function stripLeadingPunct(s: string): string {
  return s.replace(/^[\s,;.•*\-]+/, "");
}

export const icdValidator: Reconciler = (text, _source, ctx) => {
  if (!text.trim()) return text;
  const locale = ctx.language;

  const entries = findEntries(text);
  if (entries.length === 0) return text;

  // Preserve any preamble before the first code (usually empty, but
  // could be a heading the agent added).
  const preamble = text.slice(0, entries[0].codeStart).replace(/[,\s]+$/, "");

  const rebuilt: string[] = [];
  for (const entry of entries) {
    const tailRaw = text.slice(entry.codeEnd, entry.entryEnd);
    const tail = stripLeadingPunct(tailRaw).replace(/[,\s]+$/, "");
    const { body, paren } = splitTrailingParen(tail);

    const normalized = normalizeCode(entry.rawCode);
    const canonical = getIcdDescription(normalized, locale);

    if (canonical) {
      const safeParen = parenIsRedundant(canonical, paren) ? "" : paren;
      rebuilt.push(`${normalized} ${canonical}${safeParen}`);
      continue;
    }

    // CM-shaped codes (3+ decimal digits) that aren't in CSV get dropped
    // outright — their 3-char root is almost never the right fallback
    // (e.g. Z87.891 "personal history of other" → root Z87 canonical is
    // "respiratory diseases in history", unrelated). Better no code than
    // wrong code.
    if (isLikelyIcd10Cm(normalized)) {
      logger.info(
        `[icd-validator] drop ICD-10-CM-shaped code ${normalized} (${locale})`,
      );
      continue;
    }

    // 1-2 digit decimal not in CSV: try the 3-char root. If root exists,
    // downgrade — the category is at least valid even if the subdivision
    // is wrong. (E.g. H61.20 → H61 "disorders of external ear". Still
    // wrong in context, but the clinician sees an obviously-wrong code
    // instead of an invented one.)
    const rootCode = normalized.slice(0, 3);
    const rootCanonical = getIcdDescription(rootCode, locale);
    if (rootCanonical && rootCode !== normalized) {
      logger.info(
        `[icd-validator] downgrade ${normalized} → ${rootCode} (${locale})`,
      );
      const safeParen = parenIsRedundant(rootCanonical, paren) ? "" : paren;
      rebuilt.push(`${rootCode} ${rootCanonical}${safeParen}`);
      continue;
    }

    // Short code, CSV miss AND no root match — preserve agent's text.
    // Rare, usually a typo. Visible in output so the clinician can catch.
    rebuilt.push(`${normalized} ${body}${paren}`.trimEnd());
  }

  if (rebuilt.length === 0) return preamble;

  // Preserve the separator style the agent used. If the input had any
  // newline between entries, keep newlines; otherwise use ", " (Záver
  // template-worldview convention is comma-on-one-line).
  const betweenEntriesHasNewline = entries
    .slice(0, -1)
    .some((e, i) => /\n/.test(text.slice(e.codeEnd, entries[i + 1].codeStart)));
  const separator = betweenEntriesHasNewline ? "\n" : ", ";

  const joined = rebuilt.join(separator);
  const endsWithPeriod = /\.\s*$/.test(text);
  const final = endsWithPeriod && !joined.endsWith(".") ? `${joined}.` : joined;
  return preamble ? `${preamble} ${final}` : final;
};
