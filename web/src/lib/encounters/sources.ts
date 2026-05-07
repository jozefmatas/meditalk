import type { FileMetadata, VisitMetadata } from "@/lib/types";

/**
 * Centralized access to encounter source material stored in visits.metadata.
 *
 * All encounter sources (transcript, doctor notes, files) live in the JSONB
 * metadata column. These helpers provide type-safe access and a single place
 * to change if the storage shape evolves.
 */

/** Get the recording transcript from encounter metadata. */
export function getTranscript(
  metadata: VisitMetadata | null | undefined,
): string | null {
  const value = metadata?.transcript;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

/** Get doctor notes from encounter metadata. */
export function getDoctorNotes(
  metadata: VisitMetadata | null | undefined,
): string | null {
  const value = metadata?.doctor_notes;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

/** Get extracted file texts from encounter file metadata.
 *  Excludes recording files — their transcript is accessed via getTranscript(). */
export function getFileTexts(
  files: FileMetadata[],
): { name: string; type: string; text: string }[] {
  return files
    .filter((f) => f.extracted_text && f.source !== "recording")
    .map((f) => ({ name: f.name, type: f.type, text: f.extracted_text! }));
}
