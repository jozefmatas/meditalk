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
  searchIcdNormalized,
  resolveIcdCodes,
  lookupIcdByDescription,
  normalizeIcdDescription,
} from "./icd-index";
export { resolveIcdFromFacts, computeFactId } from "./diagnosis-resolver";
export {
  buildEncounterModel,
  classifyProblem,
  factId,
} from "./encounter-model";
export type {
  EncounterModel,
  ProblemItem,
  FactRef,
  BuildEncounterModelInput,
} from "./encounter-model";
export {
  renderAssessmentFromModel,
  modelHasAnyProblem,
} from "./renderers/assessment";
export {
  resolveSpecialtyPack,
  registerSpecialtyPack,
  listSpecialtyPacks,
} from "./specialty-pack";
export type { SpecialtyPack, DiagnosisSynonym } from "./specialty-pack";
export type {
  ResolvedIcdCode,
  DiagnosisResolutionResult,
} from "./diagnosis-resolver";
// assessment-structuring + assessment-classifier removed in Phase 6.
// All bucketing (primary/secondary/chronic/differential) now lives in
// encounter-model.ts → `classifyProblem` + `buildEncounterModel`.
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
  resolveTimelineCoherence,
  extractTemporalAnchor,
} from "./timeline-coherence";
export type {
  TemporalAnchor,
  TemporalKind,
  TimelineConflict,
  TimelineCoherenceResult,
} from "./timeline-coherence";
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
  renderVitals,
  renderEkg,
  renderLabs,
  detectVitalsKindFromLabel,
} from "./section-renderer";
export type { RenderTier, SectionTier, RenderUsage } from "./section-renderer";
export {
  parseMeasurement,
  checkMeasurementSanity,
  validateMeasurementValue,
} from "./numeric-sanity";
export type {
  MeasurementKind,
  ParsedMeasurement,
  SanityVerdict,
} from "./numeric-sanity";
export {
  validateMedicationStrength,
  getValidStrengthsForBase,
  normalizeStrength,
} from "./medication-strength";
export type { StrengthVerdict } from "./medication-strength";
export { runSanityGate, stripPhiOnlyLines } from "./sanity-gate";
export { enforceSectionPurity } from "./section-purity";
export type {
  SectionPurityResult,
  SectionPurityViolation,
  PurityRejectionReason,
} from "./section-purity";
export {
  extractNarrativeEvidence,
  formatNarrativeEvidence,
} from "./narrative-evidence";
export type {
  NarrativeSnippet,
  NarrativeSources,
  NarrativeEvidenceOptions,
} from "./narrative-evidence";
export type {
  SanityReport,
  SanityIssue,
  SanityIntervention,
  SanitySeverity,
  SanityGateInput,
  SanityGateResult,
} from "./sanity-gate";
