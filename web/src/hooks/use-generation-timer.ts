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
 */
function estimateGenerationTime(metrics: ContentMetrics): number {
  const totalTextLength = metrics.transcriptLength + metrics.doctorNotesLength;
  const estimatedTokens = Math.ceil(totalTextLength / CONFIG.CHARS_PER_TOKEN);

  const clinicalSeconds =
    (estimatedTokens * CONFIG.CLINICAL_ANALYSIS_MS_PER_TOKEN) / 1000;
  const generationSeconds = (estimatedTokens * CONFIG.OPUS_MS_PER_TOKEN) / 1000;

  // Minimum 30s — even short content takes time for Opus generation
  return Math.max(
    30,
    clinicalSeconds + generationSeconds + CONFIG.BASE_OVERHEAD_SECONDS,
  );
}

/**
 * Format seconds into MM:SS countdown string (e.g. "02:11", "00:45")
 */
function formatTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Hook for tracking and estimating generation completion time.
 *
 * Uses elapsed seconds + section progress to compute remaining time.
 * Resets elapsed via the "adjust state during render" pattern
 * (React-recommended alternative to setState in effects).
 */
export function useGenerationTimer({
  isGenerating,
  totalSections,
  completedSections,
  contentMetrics,
}: UseGenerationTimerProps): GenerationTimerState | null {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [wasGenerating, setWasGenerating] = useState(false);

  // Reset elapsed when generation starts — "adjust state during render" pattern
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (isGenerating && !wasGenerating) {
    setWasGenerating(true);
    setElapsedSeconds(0);
  } else if (!isGenerating && wasGenerating) {
    setWasGenerating(false);
  }

  // Tick elapsed seconds while generating
  useEffect(() => {
    if (!isGenerating) return;

    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, CONFIG.UPDATE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isGenerating]);

  // Compute timer state from elapsed + section progress
  const timerState = useMemo((): GenerationTimerState | null => {
    if (!isGenerating || totalSections === 0) return null;

    const initialETA = estimateGenerationTime(contentMetrics);
    let remaining: number;

    if (completedSections > 0 && totalSections > 0) {
      const avgPerSection = elapsedSeconds / completedSections;
      const remainingSections = totalSections - completedSections;
      const refined = remainingSections * avgPerSection;

      // Weighted average: trust refined more after threshold sections
      const weight = Math.min(
        completedSections / CONFIG.REFINEMENT_TRUST_THRESHOLD,
        1,
      );
      const naive = Math.max(0, initialETA - elapsedSeconds);
      remaining = naive * (1 - weight) + refined * weight;
    } else {
      remaining = Math.max(0, initialETA - elapsedSeconds);
    }

    remaining = Math.max(0, remaining);

    const progress = totalSections > 0 ? completedSections / totalSections : 0;

    return {
      estimatedSecondsRemaining: remaining,
      formattedTime: formatTime(remaining),
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
