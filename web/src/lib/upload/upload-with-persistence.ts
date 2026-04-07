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
  // Pre-flight: reject empty files immediately (likely a permission/read issue)
  if (blob.size === 0) {
    throw new Error(
      `[upload] ${name}: file is empty (0 bytes) — the device may not have permission to read this file`,
    );
  }

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
      // Capture full error details — some errors serialize as empty `{}`
      const errorDetail =
        err instanceof Error
          ? `${err.name}: ${err.message}`
          : typeof err === "object" && err !== null
            ? JSON.stringify(err)
            : String(err);

      logger.error(
        `[upload] ${name} (${blob.size} bytes, ${blob.type || "unknown"}) attempt ${attempt + 1}/${UPLOAD_MAX_RETRIES + 1} failed: ${errorDetail}`,
      );

      if (attempt < UPLOAD_MAX_RETRIES) {
        const delay = UPLOAD_RETRY_DELAYS[attempt];
        options?.onRetry?.(attempt + 1, UPLOAD_MAX_RETRIES + 1);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw new Error(
          `Upload failed after ${UPLOAD_MAX_RETRIES + 1} attempts: ${errorDetail}`,
        );
      }
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error("Upload failed");
}

/** @deprecated Use uploadWithRetry instead */
export const uploadWithPersistence = uploadWithRetry;
