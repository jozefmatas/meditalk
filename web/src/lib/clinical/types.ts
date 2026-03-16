import type { SupportedLanguage } from "../types";

/** A single regional term normalization rule */
export interface RegionalTerm {
  /** Colloquial/dialect/abbreviated forms (case-insensitive matching) */
  variants: string[];
  /** Standard clinical term to normalize to */
  standard: string;
  /** Languages this rule applies to */
  languages: SupportedLanguage[];
}

/** A clinical concept for concept matching */
export interface ClinicalConcept {
  /** Unique concept identifier, e.g. "hypertension" */
  id: string;
  /** Canonical English name for ICD mapping */
  canonicalName: string;
  /** Trigger phrases per language (case-insensitive) */
  triggers: Record<SupportedLanguage, string[]>;
  /** Relevant specialties */
  specialties: SpecialtyId[];
  /** ICD-10 category codes (3-char prefixes, e.g. ["I10", "I11"]) */
  icdHints: string[];
}

/** Supported medical specialties */
export type SpecialtyId =
  | "general_practice"
  | "internal_medicine"
  | "cardiology"
  | "pulmonology"
  | "gastroenterology"
  | "neurology"
  | "orthopedics"
  | "dermatology"
  | "psychiatry"
  | "pediatrics"
  | "gynecology"
  | "urology"
  | "endocrinology"
  | "oncology"
  | "ent";

/** Specialty prompt pack — augments the base template system prompt */
export interface SpecialtyPromptPack {
  id: SpecialtyId;
  /** English display name */
  name: string;
  /** Extra instructions appended to the system prompt for Pass 2 */
  systemPromptAddendum: string;
  /** Template sections this specialty emphasizes */
  emphasizedSections: string[];
  /** Terminology guidance for the LLM */
  terminologyNotes: string;
}

/** Output of Pass 1 (Haiku clinical analysis) */
export interface ClinicalAnalysis {
  /** Clinical concepts detected */
  matchedConcepts: MatchedConcept[];
  /** Inferred primary specialty */
  inferredSpecialty: SpecialtyId;
  /** Secondary specialty if applicable */
  secondarySpecialty?: SpecialtyId;
  /** Groups of related concepts */
  problemClusters: ProblemCluster[];
  /** Candidate ICD-10 codes */
  candidateIcdCodes: CandidateIcdCode[];
  /** Pass 1 token usage */
  usage: { inputTokens: number; outputTokens: number };
}

export interface MatchedConcept {
  conceptId: string;
  canonicalName: string;
  confidence: "high" | "medium" | "low";
  /** Exact phrases from transcript that triggered this match */
  evidence: string[];
}

export interface ProblemCluster {
  label: string;
  conceptIds: string[];
}

export interface CandidateIcdCode {
  code: string;
  description: string;
  confidence: "high" | "medium" | "low";
  /** Which matched concept(s) led to this suggestion */
  sourceConceptIds: string[];
}

/** ICD-10 entry from the CSV index */
export interface IcdEntry {
  description: string;
  code: string;
}
