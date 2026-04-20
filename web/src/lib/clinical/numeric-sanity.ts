/**
 * Numeric + unit sanity checks for measurement facts.
 *
 * Pass 1.5 extracts measurements as free-form strings like "TK 150/80 mmHg"
 * or "Glykémia 11,1 mmol/l". Before rendering, we run physiologically
 * plausible range checks so an OCR slip or transcription error ("SpO2 120%",
 * "HR 350", "BP 800/100") never reaches the note.
 *
 * Strategy per fact:
 *  - `ok`         — value is in the expected range, pass through
 *  - `suspicious` — value is unusual but physiologically possible, keep and warn
 *  - `impossible` — value is physiologically impossible, drop
 *  - `unparseable`— measurement kind could not be identified, no action
 *
 * The caller (fact-validator.ts) decides what to do with each verdict. The
 * parser is intentionally conservative: if we can't confidently identify
 * the measurement kind, we return `unparseable` and leave the fact untouched
 * rather than risk dropping something legitimate.
 */

/** Measurement kinds we know how to range-check. */
export type MeasurementKind =
  | "bp" // blood pressure, two values
  | "hr" // heart rate / pulse (bpm)
  | "rr" // respiratory rate (per minute)
  | "spo2" // oxygen saturation (%)
  | "temp_c" // body temperature (°C)
  | "glucose_mmol" // blood glucose (mmol/L)
  | "glucose_mgdl" // blood glucose (mg/dL)
  | "weight_kg" // body weight (kg)
  | "height_cm" // body height (cm)
  | "gcs"; // Glasgow Coma Scale (3–15)

export interface ParsedMeasurement {
  kind: MeasurementKind;
  /** 1 value for most kinds; 2 values for BP (systolic, diastolic). */
  values: number[];
  /** Raw unit string as detected, if any. */
  unit: string | null;
  /** The original value after timestamp/parenthetical trim. */
  normalized: string;
}

export type SanityVerdict =
  | { ok: true; kind: MeasurementKind }
  | {
      ok: false;
      severity: "suspicious" | "impossible" | "unparseable";
      kind: MeasurementKind | null;
      reason: string;
    };

/**
 * Per-kind physiologic ranges.
 * `impossible` bounds are hard floor/ceiling — nothing in this range survives.
 * `suspicious` bounds are narrower — values outside trigger a warning but pass.
 */
interface Range {
  impossibleMin: number;
  impossibleMax: number;
  suspiciousMin: number;
  suspiciousMax: number;
}

const RANGES: Record<MeasurementKind, Range | Range[]> = {
  // Systolic / diastolic are checked against separate ranges
  bp: [
    {
      impossibleMin: 40,
      impossibleMax: 300,
      suspiciousMin: 70,
      suspiciousMax: 250,
    },
    {
      impossibleMin: 10,
      impossibleMax: 200,
      suspiciousMin: 35,
      suspiciousMax: 150,
    },
  ],
  hr: {
    impossibleMin: 20,
    impossibleMax: 300,
    suspiciousMin: 30,
    suspiciousMax: 220,
  },
  rr: {
    impossibleMin: 3,
    impossibleMax: 80,
    suspiciousMin: 6,
    suspiciousMax: 50,
  },
  spo2: {
    impossibleMin: 0,
    impossibleMax: 100,
    suspiciousMin: 70,
    suspiciousMax: 100,
  },
  temp_c: {
    impossibleMin: 28,
    impossibleMax: 45,
    suspiciousMin: 34,
    suspiciousMax: 42,
  },
  glucose_mmol: {
    impossibleMin: 0.5,
    impossibleMax: 60,
    suspiciousMin: 2,
    suspiciousMax: 40,
  },
  glucose_mgdl: {
    impossibleMin: 10,
    impossibleMax: 1200,
    suspiciousMin: 30,
    suspiciousMax: 700,
  },
  weight_kg: {
    impossibleMin: 0.3,
    impossibleMax: 400,
    suspiciousMin: 2,
    suspiciousMax: 250,
  },
  height_cm: {
    impossibleMin: 20,
    impossibleMax: 260,
    suspiciousMin: 40,
    suspiciousMax: 230,
  },
  gcs: {
    impossibleMin: 3,
    impossibleMax: 15,
    suspiciousMin: 3,
    suspiciousMax: 15,
  },
};

/**
 * Strip trailing timestamps in parens (e.g. "(14:02)") and collapse spaces.
 * Leaves the rest intact for kind detection.
 */
function stripTrailingTimestamp(raw: string): string {
  return raw
    .replace(/\s*\(\s*\d{1,2}[:.]\d{2}(?::\d{2})?\s*\)\s*$/u, "")
    .trim();
}

/**
 * Replace Slovak/Czech decimal commas with dots so parseFloat works.
 * "11,1" → "11.1". Only replaces commas immediately between digits to
 * avoid mangling "systolic, diastolic" or other list separators.
 */
function normalizeDecimalSeparator(raw: string): string {
  return raw.replace(/(\d),(\d)/g, "$1.$2");
}

/**
 * Detect the measurement kind from the free-form fact value.
 *
 * Uses prefix keywords (TK, BP, Glykémia, ...) first, then falls back to
 * unit-based detection (mmHg → bp, % → spo2, etc.). Returns null when we
 * cannot confidently identify the kind.
 */
function detectKind(value: string): MeasurementKind | null {
  const lower = value.toLowerCase();

  // Blood pressure — look for "NN/NN" pattern accompanied by BP keyword
  // or the mmHg unit. Without one of these signals we don't assume BP
  // (it could be a fraction/ratio in some other context).
  if (/\d{1,3}\s*\/\s*\d{1,3}/.test(value)) {
    if (
      /\btk\b|\bbp\b|tlak|pressure|mmhg/i.test(value) ||
      /mm\s*hg/i.test(lower)
    ) {
      return "bp";
    }
  }

  // SpO2 — oxygen saturation
  if (
    /spo\s*2|o2\s*sat|o₂\s*sat|saturác|saturac|saturation|sato2/i.test(value)
  ) {
    return "spo2";
  }

  // Heart rate — SF (srdcová frekvencia), P (puls), HR, tep
  if (/\bsf\b|\bhr\b|\bpulse?\b|\btep\b|srdcov/i.test(value)) {
    return "hr";
  }

  // Respiratory rate — DF (dychová frekvencia), RR, dych
  if (/\bdf\b|\brr\b|dýchani|dychov|respiratory|respir/i.test(value)) {
    return "rr";
  }

  // Temperature — °C signal, or keyword
  if (
    /telesn[aá]?\s*teplot|teplota|temperature|°\s*c|deg\s*c|tt\b/i.test(value)
  ) {
    return "temp_c";
  }

  // Glucose — mmol/L vs mg/dL distinguished by unit
  if (/glyk[eé]mi|glucose|gluk[oó]z|glyc[eé]mi/i.test(value)) {
    if (/mg\s*\/\s*dl/i.test(value)) return "glucose_mgdl";
    return "glucose_mmol";
  }

  // GCS — integer scale, no unit
  if (/\bgcs\b/i.test(value)) return "gcs";

  // Weight
  if (/hmotnos|weight|vaha|v[aá]h[aá]|\bkg\b/i.test(value)) {
    return "weight_kg";
  }

  // Height
  if (/v[yý]ška|height|\bcm\b/i.test(value) && !/mm\s*hg/i.test(value)) {
    return "height_cm";
  }

  return null;
}

/**
 * Extract numeric values from a measurement string.
 * For BP we expect "NN/NN" and return [systolic, diastolic].
 * For everything else we return the first numeric literal found.
 */
function extractValues(value: string, kind: MeasurementKind): number[] {
  const normalized = normalizeDecimalSeparator(value);
  if (kind === "bp") {
    const m = normalized.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
    if (!m) return [];
    return [Number.parseFloat(m[1]), Number.parseFloat(m[2])];
  }
  // Numbers must not be attached to a preceding letter/digit — otherwise we'd
  // pick up the "2" inside "SpO2" or "O2SAT" rather than the actual reading.
  const m = normalized.match(/(?<![A-Za-z0-9])-?\d+(?:\.\d+)?/);
  if (!m) return [];
  return [Number.parseFloat(m[0])];
}

/** Detect the unit string if present (for diagnostic messages only). */
function extractUnit(value: string, kind: MeasurementKind): string | null {
  switch (kind) {
    case "bp":
      return /mm\s*hg/i.test(value) ? "mmHg" : null;
    case "hr":
    case "rr":
      return /\/\s*min|bpm/i.test(value) ? "/min" : null;
    case "spo2":
      return value.includes("%") ? "%" : null;
    case "temp_c":
      return /°\s*c|deg\s*c/i.test(value) ? "°C" : null;
    case "glucose_mmol":
      return /mmol\s*\/\s*l/i.test(value) ? "mmol/L" : null;
    case "glucose_mgdl":
      return /mg\s*\/\s*dl/i.test(value) ? "mg/dL" : null;
    case "weight_kg":
      return /\bkg\b/i.test(value) ? "kg" : null;
    case "height_cm":
      return /\bcm\b/i.test(value) ? "cm" : null;
    case "gcs":
      return null;
  }
}

/**
 * Parse a free-form measurement fact value into a typed measurement.
 * Returns null if we can't identify the kind or extract numeric values.
 */
export function parseMeasurement(raw: string): ParsedMeasurement | null {
  if (!raw || !raw.trim()) return null;
  const normalized = stripTrailingTimestamp(raw.trim());
  const kind = detectKind(normalized);
  if (!kind) return null;
  const values = extractValues(normalized, kind);
  if (values.length === 0) return null;
  if (kind === "bp" && values.length !== 2) return null;
  const unit = extractUnit(normalized, kind);
  return { kind, values, unit, normalized };
}

/**
 * Classify a single numeric value against its range.
 * Returns null when inside the normal band; otherwise the severity.
 */
function classifyValue(
  value: number,
  range: Range,
): "suspicious" | "impossible" | null {
  if (value < range.impossibleMin || value > range.impossibleMax) {
    return "impossible";
  }
  if (value < range.suspiciousMin || value > range.suspiciousMax) {
    return "suspicious";
  }
  return null;
}

/**
 * Run physiologic range checks on a parsed measurement.
 * Returns `{ok: true, ...}` when all values are within the normal band.
 */
export function checkMeasurementSanity(
  parsed: ParsedMeasurement,
): SanityVerdict {
  const ranges = RANGES[parsed.kind];
  if (Array.isArray(ranges)) {
    // Paired ranges — used for BP (systolic, diastolic).
    let worst: "suspicious" | "impossible" | null = null;
    const reasons: string[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const severity = classifyValue(parsed.values[i], ranges[i]);
      if (severity === "impossible") {
        worst = "impossible";
        reasons.push(
          `${i === 0 ? "systolic" : "diastolic"} ${parsed.values[i]} outside ${ranges[i].impossibleMin}–${ranges[i].impossibleMax}`,
        );
      } else if (severity === "suspicious" && worst !== "impossible") {
        worst = "suspicious";
        reasons.push(
          `${i === 0 ? "systolic" : "diastolic"} ${parsed.values[i]} outside ${ranges[i].suspiciousMin}–${ranges[i].suspiciousMax}`,
        );
      }
    }
    // Cross-check: systolic must be > diastolic (ignoring tiny equal cases).
    if (worst !== "impossible" && parsed.values[0] <= parsed.values[1]) {
      return {
        ok: false,
        severity: "impossible",
        kind: parsed.kind,
        reason: `systolic ≤ diastolic (${parsed.values[0]}/${parsed.values[1]})`,
      };
    }
    if (worst) {
      return {
        ok: false,
        severity: worst,
        kind: parsed.kind,
        reason: reasons.join("; "),
      };
    }
    return { ok: true, kind: parsed.kind };
  }

  const severity = classifyValue(parsed.values[0], ranges);
  if (severity === "impossible") {
    return {
      ok: false,
      severity: "impossible",
      kind: parsed.kind,
      reason: `${parsed.values[0]} outside ${ranges.impossibleMin}–${ranges.impossibleMax}${parsed.unit ? " " + parsed.unit : ""}`,
    };
  }
  if (severity === "suspicious") {
    return {
      ok: false,
      severity: "suspicious",
      kind: parsed.kind,
      reason: `${parsed.values[0]} outside ${ranges.suspiciousMin}–${ranges.suspiciousMax}${parsed.unit ? " " + parsed.unit : ""}`,
    };
  }
  return { ok: true, kind: parsed.kind };
}

/**
 * Convenience: parse + check in one call.
 * Returns `{severity: "unparseable"}` when the value can't be parsed, so
 * callers can distinguish "not a measurement we check" from "clearly wrong".
 */
export function validateMeasurementValue(value: string): SanityVerdict {
  const parsed = parseMeasurement(value);
  if (!parsed) {
    return {
      ok: false,
      severity: "unparseable",
      kind: null,
      reason: "could not identify measurement kind or numeric value",
    };
  }
  return checkMeasurementSanity(parsed);
}
