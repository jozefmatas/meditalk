import { uploadToStorage } from "@/lib/supabase/upload";
import { logger } from "@/lib/logger";

export interface UploadResult {
  id: string;
  name: string;
  size: number;
  type: string;
  path: string;
  source?: string;
}

const UPLOAD_MAX_RETRIES = 10;
const UPLOAD_RETRY_DELAYS = [
  2000, 3000, 5000, 5000, 10000, 10000, 15000, 15000, 30000, 30000,
];

/**
 * Upload a file with retry logic.
 *
 * @param blob - The file blob to upload
 * @param name - Filename
 * @param visitId - Encounter/visit ID
 * @param options - Optional source identifier and callbacks
 * @returns Upload result with path and fileId
 * @throws Error if all retries exhausted
 */
export async function uploadWithRetry(
  blob: Blob,
  name: string,
  visitId: string,
  options?: {
    source?: string;
    onRetry?: (attempt: number, maxAttempts: number) => void;
    onProgress?: (uploaded: boolean) => void;
  },
): Promise<UploadResult> {
  for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const { path, fileId } = await uploadToStorage(blob, name, {
        encounterId: visitId,
      });

      options?.onProgress?.(true);

      return {
        id: fileId,
        name,
        size: blob.size,
        type: blob.type || "application/octet-stream",
        path,
        source: options?.source,
      };
    } catch (err) {
      logger.error(
        `[upload] ${name} attempt ${attempt + 1}/${UPLOAD_MAX_RETRIES + 1} failed:`,
        err,
      );

      if (attempt < UPLOAD_MAX_RETRIES) {
        const delay = UPLOAD_RETRY_DELAYS[attempt];
        options?.onRetry?.(attempt + 1, UPLOAD_MAX_RETRIES + 1);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw new Error(
          `Upload failed after ${UPLOAD_MAX_RETRIES + 1} attempts: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error("Upload failed");
}

/** @deprecated Use uploadWithRetry instead */
export const uploadWithPersistence = uploadWithRetry;
