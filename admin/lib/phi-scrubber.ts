/**
 * Slim PHI scrubber for admin-side reference-note ingestion.
 *
 * Doctors upload their own finished notes as style corpus. Those notes
 * carry real patient data — before we store them and inject them into
 * prompts, we scrub deterministic PII patterns (rodné číslo, phone,
 * email, PSČ + city). Patient name redaction is out of scope here —
 * doctors are expected to have anonymised names in the reference note
 * themselves; we catch the high-signal numeric/email identifiers.
 */

/** Slovak/Czech birth number (rodné číslo): YYMMDD/XXXX or YYMMDDXXXX. */
const BIRTH_NUMBER_REGEX =
  /\b(\d{2})(0[1-9]|1[0-2]|5[1-9]|6[0-2])(0[1-9]|[12]\d|3[01])\/?(\d{3,4})\b/g;

/** +421/+420 phones or local 0-prefix. */
const PHONE_REGEX =
  /(?:\+42[01])\s*\d{3}\s*\d{3}\s*\d{3}\b|\b0\d{3}\s*\d{3}\s*\d{3}\b/g;

const EMAIL_REGEX = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/gi;

/** PSČ + city. "821 03 Bratislava-Ružinov", "110 00 Praha 1". */
const PSC_CITY_REGEX =
  /\b\d{3}\s?\d{2}\s+[A-ZÁÄČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ][\p{L}\-]*(?:\s+\d+)?/gu;

export interface PhiScrubResult {
  scrubbed: string;
  redactions: number;
}

export function scrubPhi(text: string): PhiScrubResult {
  if (!text) return { scrubbed: text, redactions: 0 };
  let out = text;
  let redactions = 0;

  out = out.replace(BIRTH_NUMBER_REGEX, () => {
    redactions++;
    return "[PATIENT_ID]";
  });
  out = out.replace(PHONE_REGEX, () => {
    redactions++;
    return "[PHONE]";
  });
  out = out.replace(EMAIL_REGEX, () => {
    redactions++;
    return "[EMAIL]";
  });
  out = out.replace(PSC_CITY_REGEX, () => {
    redactions++;
    return "[ADDRESS]";
  });

  return { scrubbed: out, redactions };
}
