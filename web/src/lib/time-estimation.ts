/**
 * Smart time estimation for generation pipeline
 * Based on empirical measurements from production logs
 */

// File extraction time constants (milliseconds)
const EXTRACTION_TIME = {
  // Images: OCR is slow, ~15-60s depending on complexity
  // Use file size as proxy: ~1s per 100KB
  image: {
    baseTime: 15000, // 15s minimum
    perKB: 10, // 10ms per KB
    maxTime: 90000, // 90s maximum
  },
  // Audio: Transcription via ElevenLabs, ~0.3-0.5s per second of audio
  // Approximate audio duration from file size: m4a ~100KB/min, mp3 ~1MB/min
  audio: {
    baseTime: 3000, // 3s minimum
    perKB: 5, // 5ms per KB (conservative estimate)
    maxTime: 120000, // 2min maximum
  },
  // PDF: OCR per page, ~5-10s per page
  // Approximate pages from file size: ~50-200KB per page
  pdf: {
    baseTime: 8000, // 8s minimum
    perKB: 8, // 8ms per KB
    maxTime: 180000, // 3min maximum
  },
};

// Generation time constants (milliseconds)
const GENERATION_TIME = {
  // Clinical analysis: Haiku analyzing transcript for concepts/ICD codes
  // Production: 9s for 5175 tokens = 1.7ms/token (faster than generation - structured extraction)
  clinicalAnalysisPerToken: 1.7,

  // Single-pass Opus generation (based on input token count)
  // Opus: ~11ms per input token (56716ms / 5177 tokens)
  opusPerToken: 11,
  opusBaseTime: 5000, // 5s minimum
};

import type { FileMetadata } from "@/lib/types";

/**
 * Estimate extraction time for a single file
 */
function estimateFileExtractionTime(file: FileMetadata): number {
  // Skip if already extracted
  if (file.extraction_status === "completed" && file.extracted_text) {
    return 0;
  }

  const sizeKB = file.size / 1024;
  let estimate = 0;

  if (file.type.startsWith("image/")) {
    estimate =
      EXTRACTION_TIME.image.baseTime + sizeKB * EXTRACTION_TIME.image.perKB;
    estimate = Math.min(estimate, EXTRACTION_TIME.image.maxTime);
  } else if (file.type.startsWith("audio/")) {
    estimate =
      EXTRACTION_TIME.audio.baseTime + sizeKB * EXTRACTION_TIME.audio.perKB;
    estimate = Math.min(estimate, EXTRACTION_TIME.audio.maxTime);
  } else if (file.type === "application/pdf") {
    estimate =
      EXTRACTION_TIME.pdf.baseTime + sizeKB * EXTRACTION_TIME.pdf.perKB;
    estimate = Math.min(estimate, EXTRACTION_TIME.pdf.maxTime);
  }

  return Math.round(estimate);
}

/**
 * Estimate total generation time including file extraction and two-pass generation
 *
 * @param files - Array of files to extract
 * @param estimatedInputTokens - Estimated input tokens for generation (use ~5000 if unknown)
 * @param hasTranscript - Whether real-time transcript is available (skips audio extraction)
 * @param hasDoctorNotes - Whether doctor notes are present
 * @returns Estimated total time in milliseconds
 */
export function estimateGenerationTime(
  files: FileMetadata[],
  estimatedInputTokens: number = 5000,
  hasTranscript: boolean = false,
  hasDoctorNotes: boolean = false,
): number {
  let totalTime = 0;

  // 1. File extraction time (parallel, so use MAX not SUM)
  const filesToExtract = files.filter(
    (f) => !(f.extraction_status === "completed" && f.extracted_text),
  );

  let maxExtractionTime = 0;
  if (filesToExtract.length > 0) {
    // If transcript available, skip audio file extraction
    const filesToProcess = hasTranscript
      ? filesToExtract.filter((f) => !f.type.startsWith("audio/"))
      : filesToExtract;

    const extractionTimes = filesToProcess.map(estimateFileExtractionTime);
    maxExtractionTime = Math.max(...extractionTimes, 0);
  }

  // 2. Clinical analysis (Haiku analyzing transcript) - runs in parallel with extraction
  let clinicalTime = 0;
  if (files.length > 0 || hasTranscript || hasDoctorNotes) {
    clinicalTime =
      estimatedInputTokens * GENERATION_TIME.clinicalAnalysisPerToken;
  }

  // Extraction and clinical run in parallel (Promise.all), so use MAX
  const parallelPhaseTime = Math.max(maxExtractionTime, clinicalTime);
  totalTime += parallelPhaseTime;

  // 3. Single-pass Opus generation (sequential after parallel phase)
  const opusTime =
    GENERATION_TIME.opusBaseTime +
    estimatedInputTokens * GENERATION_TIME.opusPerToken;

  totalTime += opusTime;

  return Math.round(totalTime);
}

/**
 * Format estimated time as human-readable string
 */
export function formatEstimatedTime(ms: number): string {
  const seconds = Math.ceil(ms / 1000);

  if (seconds < 60) {
    return `~${seconds}s`;
  }

  const minutes = Math.ceil(seconds / 60);
  if (minutes === 1) {
    return `~1 minute`;
  }

  return `~${minutes} minutes`;
}

/**
 * Get time estimation breakdown for debugging
 */
export function getTimeEstimationBreakdown(
  files: FileMetadata[],
  estimatedInputTokens: number = 5000,
  hasTranscript: boolean = false,
  hasDoctorNotes: boolean = false,
): {
  extraction: number;
  clinicalAnalysis: number;
  parallelPhase: number;
  opus: number;
  total: number;
} {
  const filesToExtract = files.filter(
    (f) => !(f.extraction_status === "completed" && f.extracted_text),
  );

  const filesToProcess = hasTranscript
    ? filesToExtract.filter((f) => !f.type.startsWith("audio/"))
    : filesToExtract;

  const extractionTimes = filesToProcess.map(estimateFileExtractionTime);
  const extraction = Math.max(...extractionTimes, 0);

  const clinicalAnalysis =
    files.length > 0 || hasTranscript || hasDoctorNotes
      ? estimatedInputTokens * GENERATION_TIME.clinicalAnalysisPerToken
      : 0;

  // Extraction and clinical run in parallel (Promise.all)
  const parallelPhase = Math.max(extraction, clinicalAnalysis);

  const opus =
    GENERATION_TIME.opusBaseTime +
    estimatedInputTokens * GENERATION_TIME.opusPerToken;

  return {
    extraction: Math.round(extraction),
    clinicalAnalysis: Math.round(clinicalAnalysis),
    parallelPhase: Math.round(parallelPhase),
    opus: Math.round(opus),
    total: Math.round(parallelPhase + opus),
  };
}
