import { useState, useEffect, useMemo } from "react";

/** Configuration for generation time estimation */
const CONFIG = {
  BASE_SECONDS_PER_SECTION: 3,
  CONTENT_SIZE_THRESHOLDS: {
    small: 500,
    medium: 2000,
    large: 5000,
  },
  MULTIPLIERS: {
    small: 0.8,
    medium: 1.0,
    large: 1.3,
    veryLarge: 1.6,
    perImage: 0.2,
    perPdf: 0.1,
  },
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
 * Calculate content size multiplier based on text length and file types
 */
function calculateContentMultiplier(metrics: ContentMetrics): number {
  const totalTextLength = metrics.transcriptLength + metrics.doctorNotesLength;

  // Base multiplier on text size
  let multiplier: number;
  if (totalTextLength < CONFIG.CONTENT_SIZE_THRESHOLDS.small) {
    multiplier = CONFIG.MULTIPLIERS.small;
  } else if (totalTextLength < CONFIG.CONTENT_SIZE_THRESHOLDS.medium) {
    multiplier = CONFIG.MULTIPLIERS.medium;
  } else if (totalTextLength < CONFIG.CONTENT_SIZE_THRESHOLDS.large) {
    multiplier = CONFIG.MULTIPLIERS.large;
  } else {
    multiplier = CONFIG.MULTIPLIERS.veryLarge;
  }

  // Add overhead for images and PDFs
  multiplier += metrics.imageCount * CONFIG.MULTIPLIERS.perImage;

  // Approximate PDF count (if fileCount > imageCount, assume rest might be PDFs)
  const estimatedPdfCount = Math.max(0, metrics.fileCount - metrics.imageCount);
  multiplier += estimatedPdfCount * CONFIG.MULTIPLIERS.perPdf;

  return multiplier;
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

    // Calculate initial estimate based on content size
    const contentMultiplier = calculateContentMultiplier(contentMetrics);
    const initialETA =
      totalSections * CONFIG.BASE_SECONDS_PER_SECTION * contentMultiplier;

    let estimatedSeconds: number;

    if (completedSections > 0) {
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
      estimatedSeconds = initialETA - elapsedSeconds;
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
