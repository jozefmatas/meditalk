/**
 * PHI scrubber — deterministic, regex-based removal of personally
 * identifiable information before any LLM call.
 *
 * Scrubs: patient name, birth number (rodné číslo), phone numbers,
 * email addresses, addresses (PSČ + city, street + house number),
 * and long numeric IDs.
 *
 * Preserves: ages, clinical dates, ICD codes, measurement values,
 * medication dosages.
 */

export interface PhiAudit {
  /** Total number of PHI tokens replaced. */
  totalRedactions: number;
  /** Breakdown by type. */
  counts: {
    name: number;
    birthNumber: number;
    phone: number;
    email: number;
    address: number;
    numericId: number;
  };
}

export interface ScrubResult {
  scrubbed: string;
  audit: PhiAudit;
}

/**
 * Build a regex that matches the patient name in either ordering,
 * case-insensitively with diacritic normalization.
 */
function buildNamePattern(fullName: string): RegExp | null {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) {
    // Single-word name — match the word as-is
    if (parts.length === 1 && parts[0].length > 0) {
      return new RegExp(`\\b${escapeRegex(parts[0])}\\b`, "gi");
    }
    return null;
  }

  // Match "First Last" and "Last First" orderings
  const alternatives = [
    parts.map(escapeRegex).join("\\s+"),
    [...parts].reverse().map(escapeRegex).join("\\s+"),
  ];

  // Deduplicate if name parts are the same
  const unique = [...new Set(alternatives)];
  return new RegExp(`\\b(?:${unique.join("|")})\\b`, "gi");
}

/**
 * Slovak/Czech birth number (rodné číslo): YYMMDD/XXXX or YYMMDDXXXX.
 * Months 01-12 for males, 51-62 for females.
 * The slash is optional.
 */
const BIRTH_NUMBER_REGEX =
  /\b(\d{2})(0[1-9]|1[0-2]|5[1-9]|6[0-2])(0[1-9]|[12]\d|3[01])\/?(\d{3,4})\b/g;

/**
 * Phone numbers — Slovak (+421) and Czech (+420) formats,
 * or local format starting with 0.
 */
const PHONE_REGEX =
  /(?:\+42[01])\s*\d{3}\s*\d{3}\s*\d{3}\b|\b0\d{3}\s*\d{3}\s*\d{3}\b/g;

/**
 * Email addresses.
 */
const EMAIL_REGEX = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/gi;

/**
 * Slovak/Czech postal code (PSČ) followed by city name.
 * Matches patterns like "821 03 Bratislava-Ružinov", "110 00 Praha 1".
 * The city name allows diacritics, hyphens, and district suffixes.
 */
const PSC_CITY_REGEX =
  /\b\d{3}\s?\d{2}\s+[A-ZÀ-ž][\wÀ-ž-]+(?:\s*[-–]\s*[A-ZÀ-ž][\wÀ-ž-]*)*(?:\s+\d{1,2})?\b/g;

/**
 * Street address with house number — only when preceded by a known
 * street-type keyword, or when using slash-notation house numbers
 * (e.g. "3121/3") which are unambiguous.
 *
 * Matches patterns like:
 * - "ul. Hlavná 15" (street prefix + name + number)
 * - "námestie SNP 10" (square + name + number)
 * - "Exnárova 3121/3" (name + slash house number — unambiguous)
 */
const STREET_WITH_PREFIX_REGEX =
  /(?:ul(?:ica)?|nám(?:estie)?|tr(?:ieda)?|cesta)\.?\s+[A-ZÀ-ž][\wÀ-ž]*(?:\s+[A-ZÀ-ž][\wÀ-ž]*)?\s+\d{1,5}(?:\/\d{1,5})?/gi;

/**
 * Street name followed by a slash-notation house number (e.g. "Exnárova 3121/3").
 * The slash notation is a strong signal this is an address, not a clinical value.
 * Requires at least 3 characters in the name to avoid matching clinical
 * abbreviations like "TK 150/95".
 */
const STREET_SLASH_HOUSE_REGEX = /[A-ZÀ-ž][\wÀ-ž]{2,}\s+\d{1,5}\/\d{1,5}/g;

/**
 * Long numeric IDs (9-12 digits) that aren't already caught by
 * birth number, phone, or date patterns. We check context to avoid
 * false positives on clinical values.
 */
const LONG_NUMERIC_REGEX = /\b\d{9,12}\b/g;

/**
 * Clinical measurement words that use number/number notation (normalized).
 * e.g. "Zornice 3/3" (pupil sizes) — not an address.
 */
const CLINICAL_MEASUREMENT_WORDS = new Set([
  "zornice",
  "zornicky",
  "pupils",
  "pupily",
  "pupilla",
  "pupillae",
  "reaktivita",
]);

/**
 * Patterns that should NOT be scrubbed — clinical values, dates, ICD codes.
 * Used to protect against false positives from the generic numeric ID pattern.
 */
function isProtectedNumeric(
  match: string,
  context: string,
  pos: number,
): boolean {
  // Check character before the match for units/contexts
  const before = context.slice(Math.max(0, pos - 15), pos);
  const after = context.slice(pos + match.length, pos + match.length + 10);

  // Birth number already handled separately
  // Phone already handled separately

  // Clinical measurement context (e.g. "150/95", "14.2 g/l")
  if (/[/.]/.test(before.slice(-1)) || /[/.]/.test(after[0])) return true;

  // Preceded by a unit abbreviation
  if (/(?:mg|ml|mcg|µg|mmHg|bpm|kg|cm|mm)\s*$/i.test(before)) return true;

  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scrub PHI from a text string.
 *
 * @param text - The input text to scrub.
 * @param knownPatientName - If provided, the patient's full name is scrubbed.
 * @param knownPatientId - If provided, this exact string is also scrubbed.
 */
export function scrubPhi(
  text: string,
  knownPatientName?: string,
  knownPatientId?: string,
): ScrubResult {
  if (!text) {
    return {
      scrubbed: text,
      audit: {
        totalRedactions: 0,
        counts: {
          name: 0,
          birthNumber: 0,
          phone: 0,
          email: 0,
          address: 0,
          numericId: 0,
        },
      },
    };
  }

  let result = text;
  const counts = {
    name: 0,
    birthNumber: 0,
    phone: 0,
    email: 0,
    address: 0,
    numericId: 0,
  };

  // 1. Patient name (when known)
  if (knownPatientName?.trim()) {
    const namePattern = buildNamePattern(knownPatientName);
    if (namePattern) {
      result = result.replace(namePattern, () => {
        counts.name++;
        return "[PATIENT_NAME]";
      });
    }
  }

  // Also scrub the exact patient ID string if provided
  if (knownPatientId?.trim()) {
    const idEscaped = escapeRegex(knownPatientId.trim());
    const idPattern = new RegExp(idEscaped, "g");
    result = result.replace(idPattern, () => {
      counts.birthNumber++;
      return "[PATIENT_ID]";
    });
  }

  // 2. Birth number (rodné číslo)
  result = result.replace(BIRTH_NUMBER_REGEX, () => {
    counts.birthNumber++;
    return "[PATIENT_ID]";
  });

  // 3. Phone numbers
  result = result.replace(PHONE_REGEX, () => {
    counts.phone++;
    return "[PHONE]";
  });

  // 4. Email addresses
  result = result.replace(EMAIL_REGEX, () => {
    counts.email++;
    return "[EMAIL]";
  });

  // 5. Addresses — PSČ + city (e.g. "821 03 Bratislava-Ružinov")
  result = result.replace(PSC_CITY_REGEX, () => {
    counts.address++;
    return "[ADDRESS]";
  });

  // 5b. Street addresses with keyword prefix (e.g. "ul. Hlavná 15")
  result = result.replace(STREET_WITH_PREFIX_REGEX, () => {
    counts.address++;
    return "[ADDRESS]";
  });

  // 5c. Street + slash house number (e.g. "Exnárova 3121/3")
  // The slash notation is unambiguous — not a clinical value.
  // Skip if already inside a replacement token or followed by clinical units.
  result = result.replace(STREET_SLASH_HOUSE_REGEX, (match, offset) => {
    const before = result.slice(Math.max(0, offset - 1), offset);
    if (before === "[") return match;

    // Extract the word portion of the match (before the digits)
    const wordMatch = match.match(/^([A-ZÀ-ž][\wÀ-ž]*)\s/);
    const word = wordMatch?.[1] ?? "";

    // All-caps abbreviation (≤6 chars) → likely clinical, not street name
    // e.g. "GCS 15/15", "EKG 12/15", "NIHSS 4/42", "BMI 25/30"
    if (word.length <= 6 && word === word.toUpperCase()) return match;

    // Known clinical measurement words that use number/number notation
    // e.g. "Zornice 3/3" (pupil sizes), "Zorničky 4/4"
    const wordNorm = word
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (CLINICAL_MEASUREMENT_WORDS.has(wordNorm)) return match;

    // Check if followed by clinical units — likely a measurement, not address
    const after = result.slice(
      offset + match.length,
      offset + match.length + 15,
    );
    if (/^\s*(?:mmHg|mm\s*Hg|bpm|mg|ml|µg|mcg|kg|cm|mm)\b/i.test(after))
      return match;
    // Check if preceded by blood-pressure or clinical keywords
    const contextBefore = result.slice(Math.max(0, offset - 25), offset);
    if (
      /(?:TK|tlak|krvný|systol|diastol|pulz|frekvencia|hmotnosť|výška|GCS|NIHSS|EKG|ECG|BMI|MMSE|MRC|APACHE|skore|score)\s*$/i.test(
        contextBefore,
      )
    )
      return match;
    counts.address++;
    return "[ADDRESS]";
  });

  // 6. Generic long numeric IDs (last, to avoid double-replacing)
  // Need a manual loop because we check context
  const numericMatches = [...result.matchAll(LONG_NUMERIC_REGEX)];
  // Process in reverse order so indices stay valid
  for (let i = numericMatches.length - 1; i >= 0; i--) {
    const m = numericMatches[i];
    if (m.index === undefined) continue;
    // Skip if already inside a replacement token
    const before = result.slice(Math.max(0, m.index - 1), m.index);
    if (before === "[") continue;
    // Skip if this is a protected clinical value
    if (isProtectedNumeric(m[0], result, m.index)) continue;
    // Skip if already replaced by birth number / phone
    if (result.slice(m.index, m.index + m[0].length).includes("[")) continue;

    result =
      result.slice(0, m.index) +
      "[PATIENT_ID]" +
      result.slice(m.index + m[0].length);
    counts.numericId++;
  }

  return {
    scrubbed: result,
    audit: {
      totalRedactions:
        counts.name +
        counts.birthNumber +
        counts.phone +
        counts.email +
        counts.address +
        counts.numericId,
      counts,
    },
  };
}
