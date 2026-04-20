export {
  runClinicalAnalysis,
  buildEnrichedSystemPrompt,
  buildPreRenderedIcdBlock,
} from "./pipeline";
export { extractJson } from "./json-repair";
export { getSpecialtyPromptPack } from "./specialty-prompts";
export {
  runFactExtraction,
  buildFactExtractionSystemPrompt,
  buildFactExtractionUserMessage,
  emptyExtractedFacts,
  coerceFact,
  FACT_CATEGORIES,
} from "./fact-extraction";
export type {
  ExtractedFacts,
  ExtractedFact,
  FactCategory,
  FactExtractionInput,
  SourceReference,
} from "./fact-extraction";
export {
  validateFacts,
  countFacts,
  formatFactsForPrompt,
  normalizeForMatch,
  evidenceAppearsInSource,
} from "./fact-validator";
export type {
  ValidationResult,
  RemovedFact,
  RemovalReason,
} from "./fact-validator";
export {
  buildIcdReferenceForConcepts,
  getIcdDescription,
  isValidIcdCode,
  searchIcd,
  resolveIcdCodes,
} from "./icd-index";
export {
  buildMedicationReferenceForConcepts,
  getMedicationActiveIngredient,
  isValidMedication,
  searchMedications,
  resolveMedications,
  extractBaseName,
  correctMedicationBaseName,
} from "./medication-index";
export {
  parseMedicationFact,
  reconstructMedicationValue,
} from "./medication-normalizer";
export type { ParsedMedication } from "./medication-normalizer";
export type {
  ClinicalAnalysis,
  SpecialtyId,
  SpecialtyPromptPack,
  ClinicalConcept,
  RegionalTerm,
  IcdEntry,
  MedicationEntry,
  MatchedConcept,
  ProblemCluster,
  CandidateIcdCode,
} from "./types";
export {
  computeFingerprint,
  diffFingerprints,
  sha256,
  stableStringify,
} from "./fingerprint";
export type {
  GenerationFingerprint,
  FingerprintInput,
  FingerprintDiff,
} from "./fingerprint";
export { resolveFacts, CORRECTION_PHRASES } from "./fact-resolver";
export type {
  ResolutionResult,
  ResolutionEvent,
  ResolutionReason,
} from "./fact-resolver";
export {
  filterCertainIcdCandidates,
  extractContentTokens,
} from "./icd-certainty";
export {
  assignFactsToSections,
  formatAssignedFactsForPrompt,
} from "./fact-section-assigner";
export type {
  CertaintyFilterResult,
  DroppedIcdCandidate,
  DropReason,
} from "./icd-certainty";
export { scrubPhi } from "./phi-scrubber";
export type { PhiAudit, ScrubResult } from "./phi-scrubber";
export { classifyAssessment } from "./assessment-classifier";
export type {
  ClassificationResult,
  ClassifiedCandidate,
} from "./assessment-classifier";
export {
  enforceContentRouting,
  classifySection,
} from "./section-routing-validator";
export type { SectionRole } from "./section-routing-validator";
export {
  renderSections,
  classifySectionTiers,
  renderMedications,
  renderAssessment,
} from "./section-renderer";
export type { RenderTier, SectionTier, RenderUsage } from "./section-renderer";
