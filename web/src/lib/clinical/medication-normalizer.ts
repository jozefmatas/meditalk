/**
 * Medication normalization helpers for fact validation.
 *
 * Parses medication fact values into structured components (name, dose,
 * frequency, route) and reconstructs them after name correction. The key
 * invariant: ONLY the drug name is corrected, dose/frequency/route are
 * preserved verbatim from the source.
 *
 * This eliminates the dosage fabrication bug where `correctMedicationName()`
 * returned the full CSV product name (e.g. "Eliquis 2,5 mg filmom obalene
 * tablety") and the fact validator replaced the entire fact value with it.
 */

import { extractBaseName } from "./medication-index";

export interface ParsedMedication {
  /** Base drug name (e.g. "Rytmonorm", "Eliquis", "Co-Prenessa") */
  name: string;
  /** Dosage with unit if explicitly stated (e.g. "5 mg", "2,5 mg") */
  dose?: string;
  /** Frequency/schedule (e.g. "1-0-1", "2x denne", "ráno") */
  frequency?: string;
  /** Route if explicitly stated (e.g. "p.o.", "i.v.") */
  route?: string;
  /** Everything after the name that wasn't parsed as dose/freq/route */
  remainder?: string;
}

/**
 * Dosage pattern: number + pharmaceutical unit.
 * Matches: "5 mg", "2,5 mg", "150 mg", "25 µg", "100 ml", "1000 IU"
 * Does NOT match: plain numbers without units (those could be frequencies).
 */
const DOSE_REGEX =
  /\b(\d+[,.]?\d*)\s*(mg|ml|g|µg|mcg|ug|iu|u\.i\.|mikrogramov|mikrogramů)\b/i;

/**
 * Frequency/schedule pattern.
 * Matches: "1-0-1", "1-0-0", "0-0-1", "2x denne", "ráno", "večer", "na noc"
 */
const FREQUENCY_REGEX =
  /\b(\d-\d-\d(?:-\d)?|\d+x\s*(?:denne|denn[eé]|daily|t[ýy]ž?denn?e|mesačne|měsíčně)|ráno|večer|ve[čc]er|na noc)\b/i;

/**
 * Route pattern.
 * Matches: "p.o.", "i.v.", "s.c.", "i.m.", "per os", "intravenózne"
 * No trailing \b — abbreviations end with dots (no word boundary after ".").
 * Uses lookahead (?=\s|$) so trailing space isn't consumed.
 */
const ROUTE_REGEX =
  /\b(p\.o\.|i\.v\.|s\.c\.|i\.m\.|per os|intravenózn[eě]|subkutánn[eě])(?=\s|$)/i;

/**
 * Parse a medication fact value into structured components.
 *
 * Uses the existing `extractBaseName()` to identify the drug name portion,
 * then extracts dose, frequency, and route from the remainder.
 *
 * Examples:
 *   "Rytmonorm 1-0-1"           → { name: "Rytmonorm", frequency: "1-0-1" }
 *   "Eliquis 5 mg"              → { name: "Eliquis", dose: "5 mg" }
 *   "Eliquis 2,5 mg 2x denne"  → { name: "Eliquis", dose: "2,5 mg", frequency: "2x denne" }
 *   "Koprenesa"                 → { name: "Koprenesa" }
 *   "Betaloc ZOK 25 mg 1-0-0"  → { name: "Betaloc ZOK", dose: "25 mg", frequency: "1-0-0" }
 */
export function parseMedicationFact(value: string): ParsedMedication {
  const trimmed = value.trim();
  if (!trimmed) return { name: "" };

  // Extract the base drug name using the shared logic from medication-index.
  // This cuts at the first digit or "mg"/"ml"/"tbl" marker.
  const name = extractBaseName(trimmed);

  // Everything after the name
  const afterName = trimmed.slice(name.length).trim();
  if (!afterName) return { name };

  let dose: string | undefined;
  let frequency: string | undefined;
  let route: string | undefined;

  // Extract dose (number + unit)
  const doseMatch = afterName.match(DOSE_REGEX);
  if (doseMatch) {
    dose = doseMatch[0];
  }

  // Extract frequency/schedule
  const freqMatch = afterName.match(FREQUENCY_REGEX);
  if (freqMatch) {
    frequency = freqMatch[0];
  }

  // Extract route
  const routeMatch = afterName.match(ROUTE_REGEX);
  if (routeMatch) {
    route = routeMatch[0];
  }

  // Compute remainder: everything that wasn't parsed
  let remainder = afterName;
  if (dose) remainder = remainder.replace(dose, "");
  if (frequency) remainder = remainder.replace(frequency, "");
  if (route) remainder = remainder.replace(route, "");
  remainder = remainder.replace(/\s+/g, " ").trim();

  return {
    name,
    ...(dose ? { dose } : {}),
    ...(frequency ? { frequency } : {}),
    ...(route ? { route } : {}),
    ...(remainder ? { remainder } : {}),
  };
}

/**
 * Reconstruct a medication fact value from its components.
 * Only the name is potentially corrected; dose/frequency/route are
 * preserved verbatim from the original source.
 *
 * Component order: name → dose → frequency → route → remainder
 */
export function reconstructMedicationValue(
  parsed: ParsedMedication & {
    correctedName?: string;
  },
): string {
  const parts: string[] = [parsed.correctedName ?? parsed.name];
  if (parsed.dose) parts.push(parsed.dose);
  if (parsed.frequency) parts.push(parsed.frequency);
  if (parsed.route) parts.push(parsed.route);
  if (parsed.remainder) parts.push(parsed.remainder);
  return parts.join(" ");
}
