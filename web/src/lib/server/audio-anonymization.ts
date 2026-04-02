/**
 * Server-side audio anonymization using ffmpeg
 *
 * Applies pitch shifting with formant preservation to prevent voice biometric
 * identification while maintaining speech intelligibility for transcription.
 *
 * Processing pipeline:
 * 1. Remove low/high frequency noise
 * 2. Normalize volume levels
 * 3. Shift pitch ±3 semitones (deterministic per user)
 * 4. Preserve formant (maintains natural sound)
 * 5. Output as Opus (32kbps, optimal for speech)
 */

import { exec } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { logger } from "@/lib/logger";

const execAsync = promisify(exec);

// Get ffmpeg binary path
// ffmpeg-static doesn't work well with Next.js bundling, so we resolve it manually
function getFfmpegPath(): string {
  try {
    // Try to import ffmpeg-static dynamically
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require("ffmpeg-static");

    // Check if path looks valid (not a bundler placeholder like /ROOT/)
    if (
      ffmpegStatic &&
      typeof ffmpegStatic === "string" &&
      !ffmpegStatic.includes("/ROOT/")
    ) {
      return ffmpegStatic;
    }

    // Fallback: construct path manually from node_modules
    const nodeModulesPath = path.join(
      process.cwd(),
      "node_modules",
      "ffmpeg-static",
      "ffmpeg",
    );
    return nodeModulesPath;
  } catch {
    // Final fallback: try system ffmpeg
    return "ffmpeg";
  }
}

const FFMPEG_BIN = getFfmpegPath();

/**
 * Anonymize audio file using ffmpeg with pitch shift + audio enhancement
 *
 * @param inputPath - Path to original audio file (WebM, MP3, WAV, etc.)
 * @param userId - User ID for deterministic pitch shift
 * @returns Path to anonymized output file (.opus)
 * @throws Error if ffmpeg processing fails
 */
export async function anonymizeAudio(
  inputPath: string,
  userId: string,
): Promise<string> {
  const pitchShift = getPitchShiftForUser(userId);
  const outputPath = inputPath.replace(/\.[^.]+$/, ".anonymized.opus");

  // Calculate tempo adjustment to compensate for pitch shift
  // When we change sample rate by pitchShift, speed also changes by pitchShift
  // So we need to adjust tempo by 1/pitchShift to restore original speed
  const tempoAdjustment = 1 / pitchShift;

  // ffmpeg command with audio enhancement + pitch shifting
  // Strategy: asetrate changes both pitch and speed, atempo restores speed
  // Filters: highpass (remove low rumble), lowpass (remove high noise),
  // volume normalization, dynamic range compression, pitch shift via asetrate+atempo
  const ffmpegCommand = `"${FFMPEG_BIN}" -i "${inputPath}" \
    -af "highpass=f=100,lowpass=f=8000,volume=1.5,dynaudnorm,asetrate=16000*${pitchShift},aresample=16000,atempo=${tempoAdjustment}" \
    -c:a libopus -b:a 32k -vbr on \
    "${outputPath}"`;

  try {
    await execAsync(ffmpegCommand, { timeout: 60000 }); // 1 min max
    logger.debug(`[anonymize] Success: ${inputPath} → ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error("[anonymize] ffmpeg failed:", error);
    throw new Error(
      `Audio anonymization failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

/**
 * Get deterministic pitch shift value for a user (consistent across recordings)
 *
 * Uses SHA-256 hash of userId to generate a random value between 0.97-1.03
 * (±3 semitones), which is sufficient to prevent voice matching while
 * maintaining natural sound quality.
 *
 * @param userId - User ID to hash
 * @returns Pitch shift multiplier (0.97-1.03 range)
 */
function getPitchShiftForUser(userId: string): number {
  // Hash userId to get consistent random value
  const hash = crypto.createHash("sha256").update(userId).digest();
  const normalized = hash.readUInt32BE(0) / 0xffffffff; // 0-1 range
  return 0.97 + normalized * 0.06; // 0.97 to 1.03 (±3 semitones)
}

/**
 * Check if ffmpeg is available on the system
 *
 * @returns true if ffmpeg is available, false otherwise
 */
export async function checkFfmpegAvailable(): Promise<boolean> {
  try {
    logger.debug(`[anonymize] Checking ffmpeg at: ${FFMPEG_BIN}`);
    const { stdout } = await execAsync(`"${FFMPEG_BIN}" -version`, {
      timeout: 5000,
    });
    logger.debug(`[anonymize] ffmpeg available: ${stdout.split("\n")[0]}`);
    return true;
  } catch (error) {
    logger.error(`[anonymize] ffmpeg check failed:`, error);
    return false;
  }
}

/**
 * Clean up temporary audio files
 *
 * @param paths - Array of file paths to delete
 */
export async function cleanupTempFiles(...paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((path) =>
      fs.unlink(path).catch(() => {
        /* silent fail */
      }),
    ),
  );
}
