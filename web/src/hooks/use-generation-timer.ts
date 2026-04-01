import { useState, useEffect, useMemo } from "react";

/** Configuration for generation time estimation
 * Token-based estimation from production logs (5,175 tokens):
 * - Clinical analysis (Haiku): 9s = 1.7ms/token (concept extraction)
 * - Generation (Opus): 56.7s = 11ms/token (single-pass)
 * - Token ratio: 13,459 chars → 5,175 tokens = 2.6 chars/token
 * - File extraction: ~48s per image, ~15s per audio (runs in parallel)
 */
const CONFIG = {
  // Single-pass Opus generation (milliseconds per input token)
  OPUS_MS_PER_TOKEN: 11,

  // Estimate input tokens from character count (real ratio from logs: 2.6 chars per token)
  CHARS_PER_TOKEN: 2.6,

  // Clinical analysis (Haiku): 9s for 5175 tokens = 1.7ms/token
  // Faster than generation - structured extraction vs prose generation
  CLINICAL_ANALYSIS_MS_PER_TOKEN: 1.7,

  // File extraction overhead (seconds)
  FILE_EXTRACTION_OVERHEAD: {
    perImage: 48, // OCR is very slow
    perAudio: 15, // Transcription
    perPdf: 30, // PDF OCR
  },

  // Base overhead for setup/embeddings/etc
  BASE_OVERHEAD_SECONDS: 5,

  REFINEMENT_TRUST_THRESHOLD: 3,
  UPDATE_INTERVAL_MS: 1000,
  ROUND_UP_TO_SECONDS: 5,
} as const;

interface ContentMetrics {
  transcriptLength: number;
  doctorNotesLength: number;
  fileCount: number;
  imageCount: number;
}

interface UseGenerationTimerProps {
  isGenerating: boolean;
  totalSections: number;
  completedSections: number;
  contentMetrics: ContentMetrics;
}

export interface GenerationTimerState {
  estimatedSecondsRemaining: number;
  formattedTime: string;
  progress: number; // 0-1
}

/**
 * Estimate GENERATION-ONLY time (excludes file extraction)
 * This is what should be shown in the countdown AFTER extraction is complete.
 */
function estimateGenerationTime(metrics: ContentMetrics): number {
  const totalTextLength = metrics.transcriptLength + metrics.doctorNotesLength;

  // 1. Estimate input tokens
  const estimatedTokens = Math.ceil(totalTextLength / CONFIG.CHARS_PER_TOKEN);

  // 2. Clinical analysis time (runs in parallel with extraction, but we show this in countdown)
  const clinicalMs = estimatedTokens * CONFIG.CLINICAL_ANALYSIS_MS_PER_TOKEN;
  const clinicalSeconds = clinicalMs / 1000;

  // 3. Single-pass Opus generation time (sequential after clinical/extraction)
  const generationMs = estimatedTokens * CONFIG.OPUS_MS_PER_TOKEN;
  const generationSeconds = generationMs / 1000;

  // 4. Base overhead for setup/embeddings/etc
  const overheadSeconds = CONFIG.BASE_OVERHEAD_SECONDS;

  // GENERATION-ONLY TIME (shown in countdown after extraction)
  // Clinical + Opus + overhead
  return clinicalSeconds + generationSeconds + overheadSeconds;
}

/**
 * Format seconds into human-readable time string
 */
function formatTime(seconds: number): string {
  if (seconds < 60) {
    return "lessThanMinute"; // Translation key
  }

  const minutes = Math.ceil(seconds / 60);
  if (minutes === 1) {
    return "1";
  }
  return minutes.toString();
}

/**
 * Round up seconds to nearest interval (default 5s)
 */
function roundUpSeconds(seconds: number, interval: number = 5): number {
  return Math.ceil(seconds / interval) * interval;
}

/**
 * Hook for tracking and estimating generation completion time
 *
 * Provides:
 * - Initial ETA based on content size and section count
 * - Dynamic refinement as sections complete
 * - Formatted time strings for display
 * - Progress percentage
 */
export function useGenerationTimer({
  isGenerating,
  totalSections,
  completedSections,
  contentMetrics,
}: UseGenerationTimerProps): GenerationTimerState | null {
  // Track elapsed seconds directly in state (no refs needed)
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Update elapsed time every second while generating
  useEffect(() => {
    if (!isGenerating) return;

    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, CONFIG.UPDATE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      setElapsedSeconds(0); // Reset on cleanup
    };
  }, [isGenerating]);

  // Calculate ETA
  const timerState = useMemo((): GenerationTimerState | null => {
    if (!isGenerating || totalSections === 0) return null;

    // Calculate initial estimate based on content size and file count
    const initialETA = estimateGenerationTime(contentMetrics);

    let estimatedSeconds: number;

    if (completedSections > 0 && totalSections > 0) {
      // Refine estimate based on actual progress
      const avgSecondsPerSection = elapsedSeconds / completedSections;
      const remainingSections = totalSections - completedSections;
      const refinedETA = remainingSections * avgSecondsPerSection;

      // Weighted average: trust refined estimate more after 3+ sections
      const weight = Math.min(
        completedSections / CONFIG.REFINEMENT_TRUST_THRESHOLD,
        1,
      );
      estimatedSeconds = initialETA * (1 - weight) + refinedETA * weight;
    } else {
      // No sections completed yet, use initial estimate
      estimatedSeconds = Math.max(0, initialETA - elapsedSeconds);
    }

    // Ensure estimate is positive and round up
    estimatedSeconds = Math.max(0, estimatedSeconds);
    const roundedSeconds = roundUpSeconds(
      estimatedSeconds,
      CONFIG.ROUND_UP_TO_SECONDS,
    );

    // Calculate progress
    const progress = totalSections > 0 ? completedSections / totalSections : 0;

    return {
      estimatedSecondsRemaining: roundedSeconds,
      formattedTime: formatTime(roundedSeconds),
      progress,
    };
  }, [
    isGenerating,
    totalSections,
    completedSections,
    contentMetrics,
    elapsedSeconds,
  ]);

  return timerState;
}
