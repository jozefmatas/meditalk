/**
 * SpecialtyPack — pluggable localization + specialty overlay.
 *
 * Today the pipeline hardcodes Slovak diagnosis synonyms, chronic/
 * historical/differential markers, correction phrases, ICD CSV paths,
 * and medication CSV paths in 8+ files. To go specialty-agnostic
 * (and locale-agnostic), everything that depends on WHICH language or
 * WHICH specialty reads from a single registry of packs.
 *
 * Phase 5 introduces the types + registry + the built-in packs for
 * Slovak / Czech / English "general" specialties. Subsequent phases
 * can migrate individual modules (icd-index, assessment-structuring,
 * fact-resolver, etc.) to read from the pack instead of their own
 * hardcoded lists. This file purposefully doesn't remove anything —
 * the legacy lists keep working until each module is ported.
 */

import type { SupportedLanguage } from "../types";

export interface DiagnosisSynonym {
  icd: string;
  canonical: string;
}

export interface SpecialtyPack {
  /** ISO language code this pack targets. */
  language: SupportedLanguage;
  /** Specialty id — `"general"` covers everything not otherwise specialized. */
  specialty: string;
  /** Display name (debugging / UI). */
  displayName: string;

  /** ICD CSV path (relative to `process.cwd()`). */
  icdCsvPath: string;
  /** Medication CSV path (relative to `process.cwd()`). */
  medicationCsvPath: string | null;

  /**
   * Curated abbreviation / short-form → ICD mapping for this language.
   * Key is the normalized form (diacritic-stripped, lowercased).
   */
  diagnosisSynonyms: Record<string, DiagnosisSynonym>;

  /** Substring markers routing a label to `differential` bucket. */
  differentialMarkers: string[];

  /** Substring markers routing a label to `chronic` bucket. */
  chronicMarkers: string[];

  /** Substring markers routing a label to `chronic` via historical wording. */
  historicalMarkers: string[];

  /** Substring markers that flag a symptom narrative phrase (for purity checks). */
  symptomNarrativeMarkers: string[];

  /** Substring markers identifying structured-assessment headings (purity). */
  assessmentHeadingMarkers: string[];

  /** Allergy-keyword regex source (used to split allergies out of personalHistory). */
  allergyKeywordRegexSource: string;

  /** Prompt snippets for rendering negations in this language. */
  negationRenderingGuide: string;

  /** Optional addendum appended to LLM system prompts. */
  systemPromptAddendum?: string;

  /** Display label for "not stated" fallback. */
  notStatedLabel: string;
}

// ---------------------------------------------------------------------------
// Slovak general pack (default for sk)
// ---------------------------------------------------------------------------

const SLOVAK_GENERAL: SpecialtyPack = {
  language: "sk",
  specialty: "general",
  displayName: "Slovenčina — všeobecné",
  icdCsvPath: "public/icd-10/ICD-10-SK.csv",
  medicationCsvPath: "public/medicines/sk/medicines_sk.csv",
  diagnosisSynonyms: {
    stemi: {
      icd: "I21.3",
      canonical:
        "Akútny transmurálny infarkt myokardu bez bližšieho určenia miesta",
    },
    "stemi prednej steny": {
      icd: "I21.0",
      canonical: "Akútny transmurálny infarkt myokardu prednej steny",
    },
    "stemi spodnej steny": {
      icd: "I21.1",
      canonical: "Akútny transmurálny infarkt myokardu spodnej steny",
    },
    "stemi lateralnej steny": {
      icd: "I21.2",
      canonical: "Akútny transmurálny infarkt myokardu na iných miestach",
    },
    nstemi: {
      icd: "I21.4",
      canonical: "Akútny subendokardiálny infarkt myokardu",
    },
    htn: {
      icd: "I10",
      canonical: "Primárna [esenciálna] artériová hypertenzia",
    },
    "arterialna hypertenzia": {
      icd: "I10",
      canonical: "Primárna [esenciálna] artériová hypertenzia",
    },
    hypertenzia: {
      icd: "I10",
      canonical: "Primárna [esenciálna] artériová hypertenzia",
    },
    dm2: { icd: "E11.9", canonical: "Diabetes mellitus 2. typu bez komplikácií" },
    "dm 2 typu": {
      icd: "E11.9",
      canonical: "Diabetes mellitus 2. typu bez komplikácií",
    },
    "dm ii": {
      icd: "E11.9",
      canonical: "Diabetes mellitus 2. typu bez komplikácií",
    },
    dm1: {
      icd: "E10.9",
      canonical: "Diabetes mellitus 1. typu bez komplikácií",
    },
    afib: { icd: "I48.0", canonical: "Paroxyzmálna fibrilácia predsiení" },
    "fibrilacia predsieni": {
      icd: "I48.0",
      canonical: "Paroxyzmálna fibrilácia predsiení",
    },
    copd: {
      icd: "J44.9",
      canonical: "Chronická obštrukčná choroba pľúc, bližšie neurčená",
    },
    chocp: {
      icd: "J44.9",
      canonical: "Chronická obštrukčná choroba pľúc, bližšie neurčená",
    },
    acs: {
      icd: "I24.9",
      canonical: "Akútna ischemická choroba srdca bližšie neurčená",
    },
    pe: {
      icd: "I26.9",
      canonical: "Pľúcna embólia bez zmienky o akútnom cor pulmonale",
    },
    dvt: {
      icd: "I80.2",
      canonical:
        "Flebitída a tromboflebitída iných hlbokých ciev dolných končatín",
    },
  },
  differentialMarkers: [
    " vs ",
    " vs.",
    "v.s.",
    "versus",
    "diff dg",
    "dif. dg",
    "diferencialne",
    "diferenciálne",
    "diferencialna",
    "diferenciálna",
    "rule out",
    "r/o ",
    "cannot exclude",
    "nemozno vyluc",
    "nemožno vylúč",
    "nemozno vylucit",
    "suspected",
    "suspekt",
  ],
  chronicMarkers: [
    "chronic",
    "chronick",
    "hypertenzia",
    "hypertenzie",
    "hypertension",
    "hypotyre",
    "hypothyroid",
    "diabetes",
    "osteoporos",
    "dyslipid",
    "hyperlipid",
    "hyperchol",
    "osteoartr",
    "gerd",
    "asthma",
    "copd",
    "chocp",
    "kompenzovan",
    "hyperurik",
    "apnoe",
    "mgus",
    "gamapati",
    "artralgi",
    "artroz",
    "artros",
    "regurgitac",
  ],
  historicalMarkers: [
    "stav po",
    "st.p.",
    "stp.",
    "status post",
    "post-",
    "post op",
    "postoperative",
    "history of",
    "anamnest",
  ],
  symptomNarrativeMarkers: [
    "palenie",
    "bolest",
    "od nedele",
    "od pondelka",
    "od utorka",
    "vcera",
    "dnes rano",
    "od rana",
    "pocit na hrudi",
    "dychavicnost",
    "nauzea",
    "vertigo",
  ],
  assessmentHeadingMarkers: [
    "hlavna diagnoza",
    "vedlajsie diagnozy",
    "chronicke ochoreni",
    "diferencialna diagnostika",
    "zaver",
  ],
  allergyKeywordRegexSource:
    "\\balergi|\\balerg|alergic|alergia|hypersensit|precitlivel|anafylax|intoleranc|nkda|kl neguje|kontrastn[ée]\\s+l[aá]tk|\\balergia na\\b",
  negationRenderingGuide:
    'Slovak negations: "bez <genitív>" (e.g. "bez dušnosti"), "neguje <akuzatív>" ("neguje nauzeu"), "neudáva <akuzatív>".',
  notStatedLabel: "Neuvedené",
};

// ---------------------------------------------------------------------------
// Czech general pack
// ---------------------------------------------------------------------------

const CZECH_GENERAL: SpecialtyPack = {
  ...SLOVAK_GENERAL,
  language: "cs",
  specialty: "general",
  displayName: "Čeština — obecné",
  icdCsvPath: "public/icd-10/ICD-10-CS.csv",
  medicationCsvPath: "public/medicines/cs/medicines_cs.csv",
  diagnosisSynonyms: {
    stemi: { icd: "I21.0", canonical: "Akutní transmurální infarkt myokardu" },
    nstemi: {
      icd: "I21.4",
      canonical: "Akutní subendokardiální infarkt myokardu",
    },
    htn: { icd: "I10", canonical: "Esenciální arteriální hypertenze" },
    hypertenze: { icd: "I10", canonical: "Esenciální arteriální hypertenze" },
    dm2: {
      icd: "E11.9",
      canonical: "Diabetes mellitus 2. typu bez komplikací",
    },
    afib: { icd: "I48.0", canonical: "Paroxyzmální fibrilace síní" },
  },
  assessmentHeadingMarkers: [
    "hlavni diagnoza",
    "vedlejsi diagnozy",
    "chronicka onemocneni",
    "diferencialni diagnostika",
    "zaver",
  ],
  negationRenderingGuide:
    'Czech negations: "bez <genitiv>", "neguje <akuzativ>", "neudává <akuzativ>".',
  notStatedLabel: "Neuvedeno",
};

// ---------------------------------------------------------------------------
// English general pack
// ---------------------------------------------------------------------------

const ENGLISH_GENERAL: SpecialtyPack = {
  ...SLOVAK_GENERAL,
  language: "en",
  specialty: "general",
  displayName: "English — general",
  icdCsvPath: "public/icd-10/ICD-10-GT.csv",
  medicationCsvPath: null,
  diagnosisSynonyms: {
    stemi: { icd: "I21.0", canonical: "Acute transmural myocardial infarction" },
    nstemi: {
      icd: "I21.4",
      canonical: "Acute subendocardial myocardial infarction",
    },
    htn: { icd: "I10", canonical: "Essential (primary) hypertension" },
    hypertension: { icd: "I10", canonical: "Essential (primary) hypertension" },
    "type 2 diabetes": {
      icd: "E11.9",
      canonical: "Type 2 diabetes mellitus without complications",
    },
    dm2: {
      icd: "E11.9",
      canonical: "Type 2 diabetes mellitus without complications",
    },
    afib: { icd: "I48.0", canonical: "Paroxysmal atrial fibrillation" },
    copd: {
      icd: "J44.9",
      canonical: "Chronic obstructive pulmonary disease, unspecified",
    },
  },
  assessmentHeadingMarkers: [
    "primary diagnosis",
    "secondary diagnoses",
    "chronic conditions",
    "differential diagnoses",
  ],
  symptomNarrativeMarkers: [
    "chest pain",
    "pain",
    "headache",
    "yesterday",
    "since morning",
    "since yesterday",
    "shortness of breath",
    "nausea",
    "vertigo",
  ],
  negationRenderingGuide:
    'English negations: "no <noun>", "denies <noun>", "no evidence of <noun>".',
  notStatedLabel: "Not stated",
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PACKS: SpecialtyPack[] = [SLOVAK_GENERAL, CZECH_GENERAL, ENGLISH_GENERAL];

/**
 * Resolve the best matching pack for a (language, specialty) pair.
 * Falls back to the language-level "general" pack when the requested
 * specialty isn't registered. Falls back to English "general" when the
 * language isn't supported (defensive).
 */
export function resolveSpecialtyPack(
  language: SupportedLanguage,
  specialty: string = "general",
): SpecialtyPack {
  const byExact = PACKS.find(
    (p) => p.language === language && p.specialty === specialty,
  );
  if (byExact) return byExact;
  const byLanguageGeneral = PACKS.find(
    (p) => p.language === language && p.specialty === "general",
  );
  if (byLanguageGeneral) return byLanguageGeneral;
  return ENGLISH_GENERAL;
}

/**
 * Register an additional specialty pack. Useful for tests + future
 * specialty-specific overlays that live outside this module.
 */
export function registerSpecialtyPack(pack: SpecialtyPack): void {
  const existingIdx = PACKS.findIndex(
    (p) => p.language === pack.language && p.specialty === pack.specialty,
  );
  if (existingIdx >= 0) {
    PACKS[existingIdx] = pack;
  } else {
    PACKS.push(pack);
  }
}

/** Introspection helper — exposes all registered packs. */
export function listSpecialtyPacks(): readonly SpecialtyPack[] {
  return PACKS;
}
