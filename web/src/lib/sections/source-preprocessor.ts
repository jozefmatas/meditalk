/**
 * Lightweight source pre-processor.
 *
 * Runs BEFORE the first LLM call. Scans the raw transcript + OCR files
 * for a narrow set of high-value, pattern-recognisable clinical facts
 * (medication blocks, vital-sign lines, EKG readings, transcript-level
 * brand mentions) and appends a structured `<STRUCTURED_FACTS>` XML
 * block to the transcript so the section agents can't miss them.
 *
 * Design principles:
 *   1. ADDITIVE only — raw text stays intact. Agents still see the
 *      natural-language source; the tags are supplementary signal.
 *   2. Narrow scope — only four categories. No general fact extraction,
 *      no habit / family / allergy regex, no unit normalization, no
 *      self-correction. The heavy lifting stays with the LLM.
 *   3. Deterministic. No LLM, no network, no heavy deps. Uses native
 *      `Intl.Segmenter` for Slovak-aware sentence splitting.
 *   4. Fails safe. If any step misfires, raw source is returned
 *      unchanged — agents lose signal but never get corrupted input.
 */
import type { RawSource } from "./section-agent";

// ─── Public API ────────────────────────────────────────────────────────

export type VitalKey =
  | "height"
  | "weight"
  | "bmi"
  | "bp"
  | "hr"
  | "spo2"
  | "temp";

export interface StructuredFacts {
  medicationsFromOCR: string[];
  medicationsFromTranscript: string[];
  vitals: Array<{ key: VitalKey; value: string }>;
  ekgReadings: string[];
}

export interface PreprocessResult {
  source: RawSource;
  annotations: StructuredFacts;
}

/**
 * Scan the source and return a new `RawSource` where `.transcript` has
 * a `<STRUCTURED_FACTS>` block appended at the end (only if something
 * was found). The original transcript + files remain intact.
 */
export function preprocessSource(source: RawSource): PreprocessResult {
  const annotations: StructuredFacts = {
    medicationsFromOCR: [],
    medicationsFromTranscript: [],
    vitals: [],
    ekgReadings: [],
  };

  try {
    // Scan EVERY text carrier in the source for OCR-style structured
    // blocks (medication headings, vital-sign lines, EKG readings). The
    // user can paste a discharge letter into the doctor-notes field, or
    // into the transcript field, or upload it as a file — all three are
    // valid carriers. If we only scanned `source.files`, a pasted paste
    // flow would silently lose every OCR fact.
    const ocrCarriers = [
      source.transcript ?? "",
      source.doctorNotes ?? "",
      ...(source.files?.map((f) => f.text) ?? []),
    ].filter((t) => t.trim().length > 0);

    for (const text of ocrCarriers) {
      annotations.medicationsFromOCR.push(...extractOCRMedicationLines(text));
      annotations.vitals.push(...extractVitals(text));
      annotations.ekgReadings.push(...extractEKGBlocks(text));
    }

    // Per-sentence brand-name scan — scans every natural-language carrier
    // (transcript + doctorNotes). Users sometimes paste the dialogue into
    // the doctor-notes field instead of the transcript field, so we need
    // to scan both. Files[] are usually OCR/structured and already fully
    // handled by the block scanner above.
    const naturalLanguage = [source.transcript, source.doctorNotes]
      .filter((t): t is string => !!t && t.trim().length > 0)
      .join("\n\n");
    if (naturalLanguage) {
      annotations.medicationsFromTranscript.push(
        ...extractTranscriptMeds(naturalLanguage, "sk"),
      );
    }

    // De-dupe OCR meds by base name (e.g. collapse "Arixtra 2,5 mg/0,5 ml
    // injekčný roztok" + "Arixtra 2,5 mg sc à 24h (15:00)" to the single
    // most-informative entry). Clinic referral letters routinely list each
    // drug twice — once in the pharmacist-style "Medikácia:" block (dosage
    // form) and once in the "Odporúčania:" block (dosing schedule). The
    // downstream LA agent should see ONE entry per brand with the full
    // dose + route + frequency, matching how doctors dictate a treatment
    // plan.
    annotations.medicationsFromOCR = dedupeMedications(
      annotations.medicationsFromOCR,
    );

    // Heart rate pulled from EKG / vitals text — "SF 70/min" or "HR 70/min"
    // often appears inside an EKG reading line when no dedicated vitals
    // block mentions pulse. Emit it as a vital so the Pulz agent has an
    // unambiguous structured hook.
    for (const hr of extractLooseHeartRate(ocrCarriers.join("\n"))) {
      pushUniqueVital(annotations.vitals, "hr", hr);
    }
  } catch {
    // Fail safe — return raw source unchanged on any error.
    return { source, annotations };
  }

  const annotation = buildAnnotation(annotations);
  if (!annotation) return { source, annotations };

  const augmentedTranscript = source.transcript
    ? `${source.transcript}\n\n${annotation}`
    : annotation;

  return {
    source: { ...source, transcript: augmentedTranscript },
    annotations,
  };
}

// ─── OCR medication block ──────────────────────────────────────────────

const MED_HEADING_RE =
  /^\s*(?:#{1,6}\s+)?\*{0,2}\s*(?:Medik[áa]cia|Lie[čc]ba|Lieky(?:\s+pri\s+prepusten[íi])?|Odpor[úu][čc]ania|Farmakoterapia|Naša\s+(?:posledná\s+)?terapi[ae])\s*\*{0,2}\s*:/i;

// Same heading words but WITHOUT a trailing colon — real discharge letters
// often print "Medikácia" as a sub-heading on its own line under "Liečba:".
// We treat these as soft headings: start / keep capturing, but don't try
// to read content on the same line (there isn't any).
const MED_SOFT_HEADING_RE =
  /^\s*(?:#{1,6}\s+)?\*{0,2}\s*(?:Medik[áa]cia|Lie[čc]ba|Lieky(?:\s+pri\s+prepusten[íi])?|Odpor[úu][čc]ania|Farmakoterapia|Naša\s+(?:posledná\s+)?terapi[ae])\s*\*{0,2}\s*$/i;

// A line that looks like the start of ANOTHER section — we stop on these.
const OTHER_HEADING_RE =
  /^\s*(?:#{1,6}\s+)?\*{0,2}[A-ZÁ-Ž][A-Za-zÁ-žÀ-ÿ\s()/]{2,40}:\s*\*{0,2}\s*$/;

function extractOCRMedicationLines(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  let capturing = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = stripMarkdown(rawLine);

    if (MED_HEADING_RE.test(line)) {
      capturing = true;
      // Content on the SAME line, after the colon.
      const afterColon = line.substring(line.indexOf(":") + 1).trim();
      if (afterColon) {
        out.push(...splitInlineMedications(afterColon));
      }
      continue;
    }

    // Soft heading (no colon): just flag start/continue of capture, no
    // same-line content to harvest.
    if (MED_SOFT_HEADING_RE.test(line)) {
      capturing = true;
      continue;
    }

    if (!capturing) continue;

    // Blank line or new heading → end the block.
    if (line.trim() === "" || OTHER_HEADING_RE.test(line)) {
      capturing = false;
      continue;
    }

    // Content line inside a medication block.
    out.push(...splitInlineMedications(line));
  }

  return out
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter((l) => l.length > 0 && !/^[\-–—]+$/.test(l));
}

function stripMarkdown(line: string): string {
  return line.replace(/^\s*\*\*\s*/, "").replace(/\s*\*\*\s*$/, "");
}

/**
 * Split a medication line that might be comma-separated into individual
 * entries. Handles both "Anopyrin 100 mg, Atoris 80 mg" and the
 * per-line format "Anopyrin 100 mg\nAtoris 80 mg".
 */
function splitInlineMedications(line: string): string[] {
  // Split on comma when followed by a capitalised word (next drug brand).
  const parts = line
    .split(/,\s+(?=[A-ZÁ-Ž])/)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
  return parts;
}

/**
 * Collapse duplicates by leading-letter prefix. OCR formatting variants
 * like "PRESTARIUM A 5 mg" vs "PrestariumA5mg 1/2-0-1/2" share the same
 * drug but differ in spacing — so a strict whole-token match misses them.
 * Two entries are considered the same drug when the shorter leading-alpha
 * run is a prefix of the longer AND the shared prefix is ≥5 characters.
 * "Atoridor" vs "Atoris" stay separate (neither is a prefix of the other).
 */
function dedupeMedications(lines: string[]): string[] {
  const kept: string[] = [];
  for (const line of lines) {
    const base = medBaseName(line);
    if (!base) continue;

    const existingIdx = kept.findIndex((k) =>
      sharesMedBase(medBaseName(k), base),
    );
    if (existingIdx === -1) {
      kept.push(line);
      continue;
    }
    const existing = kept[existingIdx];
    const existingHasFreq = FREQ_RE.test(existing);
    const currentHasFreq = FREQ_RE.test(line);
    if (currentHasFreq && !existingHasFreq) {
      kept[existingIdx] = line;
      continue;
    }
    if (existingHasFreq && !currentHasFreq) continue;
    if (line.length > existing.length) kept[existingIdx] = line;
  }
  return kept;
}

function medBaseName(line: string): string {
  const first = line.split(/\s+/)[0] ?? "";
  // Leading letters only — stops at the first digit or punctuation, so
  // "PrestariumA5mg" → "PrestariumA" and "Egilok25mg" → "Egilok".
  const m = first.match(/^[\p{L}]+/u);
  return (m?.[0] ?? "").toLowerCase();
}

function sharesMedBase(a: string, b: string): boolean {
  if (!a || !b) return false;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return short.length >= 5 && long.startsWith(short);
}

// ─── Vital signs ───────────────────────────────────────────────────────

/** Label map — normalized heading token → VitalKey. */
const VITAL_LABELS: Array<{ re: RegExp; key: VitalKey }> = [
  { re: /^v[ýy]ška$/i, key: "height" },
  { re: /^hmotnos[tť]$/i, key: "weight" },
  { re: /^bmi$/i, key: "bmi" },
  { re: /^tk$/i, key: "bp" },
  { re: /^(?:hr|sf)$/i, key: "hr" },
  { re: /^(?:spo2|sao2)$/i, key: "spo2" },
  { re: /^(?:tt|teplota)$/i, key: "temp" },
];

function matchVitalKey(rawLabel: string): VitalKey | null {
  const trimmed = rawLabel.trim();
  for (const { re, key } of VITAL_LABELS) {
    if (re.test(trimmed)) return key;
  }
  return null;
}

function extractVitals(text: string): Array<{ key: VitalKey; value: string }> {
  const out: Array<{ key: VitalKey; value: string }> = [];

  // Single pass: handles both one-per-line and inline formats.
  // The lookahead stops the value at the next known label, newline, or EOL,
  // so "Hmotnosť: 75 kg Výška: 164 cm BMI: 27,9" splits cleanly and
  // "Hmotnosť: 75 kg\nVýška: 164 cm" does too.
  const LABEL_SET = "Hmotnos[tť]|V[ýy]ška|BMI|TK|HR|SF|SpO2|SaO2|TT|Teplota";
  const RE = new RegExp(
    `(${LABEL_SET})\\s*:\\s*([0-9,\\.\\/\\-]+(?:\\s*[\\p{L}°%\\/]+)?)(?=\\s+(?:${LABEL_SET})\\s*:|\\s*$|\\s*\\n|$)`,
    "giu",
  );
  let match: RegExpExecArray | null;
  while ((match = RE.exec(text)) !== null) {
    const key = matchVitalKey(match[1]);
    if (!key) continue;
    const value = match[2].trim();
    if (value) pushUniqueVital(out, key, value);
  }

  return out;
}

function pushUniqueVital(
  arr: Array<{ key: VitalKey; value: string }>,
  key: VitalKey,
  value: string,
): void {
  if (arr.some((v) => v.key === key && v.value === value)) return;
  arr.push({ key, value });
}

/**
 * Catch "SF 70/min" / "HR 70/min" patterns that appear inside EKG reading
 * text or sentences, where there's no explicit `HR:` or `SF:` label
 * preceding the value. Used to give the Pulz agent a structured signal
 * even when the only pulse hint is buried inside an EKG paragraph.
 */
function extractLooseHeartRate(text: string): string[] {
  const out: string[] = [];
  const re = /\b(?:SF|HR|frekvencia|f)\s+(\d{2,3})\s*\/\s*min\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(`${m[1]}/min`);
  }
  return out;
}

// ─── EKG block ─────────────────────────────────────────────────────────

const EKG_HEADING_RE = /^\s*(?:#{1,6}\s+)?\*{0,2}\s*(?:EKG|ECG)\s*:\s*\*{0,2}/i;

function extractEKGBlocks(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  let buffer: string[] = [];
  let capturing = false;

  const flush = () => {
    const combined = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (combined) out.push(combined);
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = stripMarkdown(rawLine);

    if (EKG_HEADING_RE.test(line)) {
      flush();
      capturing = true;
      const afterColon = line.substring(line.indexOf(":") + 1).trim();
      if (afterColon) buffer.push(afterColon);
      continue;
    }

    if (!capturing) continue;

    if (line.trim() === "" || OTHER_HEADING_RE.test(line)) {
      flush();
      capturing = false;
      continue;
    }

    buffer.push(line.trim());
  }
  flush();

  // Second pass: catch mid-line "… EKG: <reading>" patterns that don't
  // sit at the start of a line. OCR'd discharge summaries often embed
  // the EKG reading in a narrative line alongside other findings.
  const MID_LINE_EKG =
    /(?:^|[^A-Za-z])EKG\s*:\s*([^\n]{5,200}?)(?=\s*(?:\n|$))/gi;
  let m: RegExpExecArray | null;
  while ((m = MID_LINE_EKG.exec(text)) !== null) {
    const reading = m[1].trim();
    if (!out.some((existing) => existing.includes(reading))) {
      out.push(reading);
    }
  }

  return out;
}

// ─── Transcript brand-name scan ────────────────────────────────────────

/**
 * Small curated list of brand-name stems that are common in Slovak
 * cardiology / internal-medicine transcripts. Each stem is matched
 * case-insensitively with a Unicode-safe boundary so "Rytmonormové"
 * doesn't match but "Rytmonorm 1-0-1" does.
 *
 * Why a whitelist instead of scanning the full CSV? The CSV has 100k+
 * entries; iterating it per transcript is wasteful, and most entries
 * are dosage variants doctors never say verbatim in speech ("Co-Prenessa
 * 4 mg /1,25 mg" is in the CSV, but the speaker says "Co-Prenessa").
 * A small hand-curated list of ~60 bare brand stems catches the common
 * cases reliably. Missing a brand just means that one transcript-side
 * hit isn't tagged — the agent still reads the raw transcript.
 */
const TRANSCRIPT_BRAND_STEMS = [
  // cardio / hypertension
  "Prestarium",
  "Prestance",
  "Amlessa",
  "Co-Prenessa",
  "Coprenessa",
  "Betaloc",
  "Egilok",
  "Bisocard",
  "Concor",
  "Losartan",
  "Micardis",
  "Tritace",
  "Ramipril",
  "Amlodipin",
  "Norvasc",
  // antiarrhythmic
  "Rytmonorm",
  "Cordarone",
  "Amiodaron",
  // antiplatelet / anticoagulant
  "Eliquis",
  "Xarelto",
  "Pradaxa",
  "Warfarin",
  "Heparin",
  "Arixtra",
  "Anopyrin",
  "Brilique",
  "Ticagrelor",
  "Clopidogrel",
  "Plavix",
  "Trombex",
  "Aspirin",
  "Aspirín",
  // lipid
  "Atoris",
  "Atoridor",
  "Atorvastatin",
  "Rosuvastatin",
  "Crestor",
  "Sortis",
  // PPI
  "Nolpaza",
  "Pantoprazol",
  "Omeprazol",
  "Controloc",
  // thyroid
  "Euthyrox",
  "Letrox",
  // analgesics
  "Zaldiar",
  "Tramadol",
  "Ibalgin",
  "Paracetamol",
  "Paralen",
  // antidepressants
  "Paretin",
  "Paroxetin",
  "Zoloft",
  "Cipralex",
  "Trittico",
  // other
  "Tunol",
  "Suplasin",
  "Sufentanil",
  "Morfín",
  "Nitroglycerín",
  "Isoket",
  "Furosemid",
  "Furon",
];

/** Dose patterns we try to capture in the same sentence as a brand. */
const DOSE_RE = /\b\d+(?:[,\.]\d+)?\s*(?:mg|μg|mcg|ml|g|IU|UI|mikrogramov)\b/i;
const FREQ_RE =
  /\b(?:\d+(?:\/\d+)?-\d+(?:\/\d+)?-\d+(?:\/\d+)?|ráno a večer|podľa potreby|raz\s+(?:denne|za\s+\w+\s+\w+)|sc\s+[aà]\s+\d+h)\b/i;

function extractTranscriptMeds(
  transcript: string,
  locale: "sk" | "cs" | "en" = "sk",
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // Slovak-aware sentence split using native Intl.Segmenter.
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });

  for (const { segment } of segmenter.segment(transcript)) {
    const sentence = segment.trim();
    if (!sentence) continue;
    const lower = sentence.toLowerCase();

    for (const stem of TRANSCRIPT_BRAND_STEMS) {
      const stemLower = stem.toLowerCase();
      if (!lower.includes(stemLower)) continue;

      // Pull dose + freq if present in the same sentence.
      const dose = sentence.match(DOSE_RE)?.[0];
      const freq = sentence.match(FREQ_RE)?.[0];

      const line = [stem, dose, freq].filter(Boolean).join(" ");
      if (seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
  }

  return out;
}

// ─── Annotation output ────────────────────────────────────────────────

function buildAnnotation(facts: StructuredFacts): string | null {
  const hasAny =
    facts.medicationsFromOCR.length > 0 ||
    facts.medicationsFromTranscript.length > 0 ||
    facts.vitals.length > 0 ||
    facts.ekgReadings.length > 0;

  if (!hasAny) return null;

  const parts: string[] = ["<STRUCTURED_FACTS>"];

  if (facts.medicationsFromOCR.length > 0) {
    parts.push(
      `<MEDICATIONS source="ocr" count="${facts.medicationsFromOCR.length}">`,
      ...facts.medicationsFromOCR.map((m) => `  ${escape(m)}`),
      `</MEDICATIONS>`,
    );
  }
  if (facts.medicationsFromTranscript.length > 0) {
    parts.push(
      `<MEDICATIONS source="transcript" count="${facts.medicationsFromTranscript.length}">`,
      ...facts.medicationsFromTranscript.map((m) => `  ${escape(m)}`),
      `</MEDICATIONS>`,
    );
  }
  if (facts.vitals.length > 0) {
    parts.push(`<VITALS count="${facts.vitals.length}">`);
    for (const v of facts.vitals) {
      parts.push(`  <VITAL key="${v.key}" value="${escapeAttr(v.value)}"/>`);
    }
    parts.push(`</VITALS>`);
  }
  if (facts.ekgReadings.length > 0) {
    parts.push(`<EKG count="${facts.ekgReadings.length}">`);
    for (const r of facts.ekgReadings) {
      parts.push(`  <READING>${escape(r)}</READING>`);
    }
    parts.push(`</EKG>`);
  }
  parts.push("</STRUCTURED_FACTS>");

  return parts.join("\n");
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escape(s).replace(/"/g, "&quot;");
}
