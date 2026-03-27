import { uploadToStorage } from "@/lib/supabase/upload";
import {
  savePendingUpload,
  deletePendingUpload,
  type PendingUpload,
} from "@/lib/indexeddb/pending-uploads";

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
 * Upload a file with IndexedDB persistence and retry logic.
 * The file is saved to IndexedDB before upload, ensuring it survives
 * browser crashes and page refreshes. Deleted from IndexedDB after success.
 *
 * @param blob - The file blob to upload
 * @param name - Filename
 * @param visitId - Encounter/visit ID
 * @param options - Optional source identifier and callbacks
 * @returns Upload result with path and fileId
 * @throws Error if all retries exhausted
 */
export async function uploadWithPersistence(
  blob: Blob,
  name: string,
  visitId: string,
  options?: {
    source?: string;
    onRetry?: (attempt: number, maxAttempts: number) => void;
    onProgress?: (uploaded: boolean) => void;
  },
): Promise<UploadResult> {
  const uploadId = crypto.randomUUID();

  // Save to IndexedDB BEFORE attempting upload
  try {
    await savePendingUpload({
      id: uploadId,
      visitId,
      blob,
      name,
      type: blob.type || "application/octet-stream",
      size: blob.size,
      source: options?.source,
      timestamp: Date.now(),
    });
  } catch (idbErr) {
    console.error(`[upload] Failed to save ${name} to IndexedDB:`, idbErr);
    // Continue anyway — at least try direct upload
  }

  // Retry upload until success
  for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const { path, fileId } = await uploadToStorage(blob, name, {
        encounterId: visitId,
      });

      // Success — delete from IndexedDB
      await deletePendingUpload(uploadId).catch((err) =>
        console.warn(`[upload] Failed to delete ${name} from IndexedDB:`, err),
      );

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
      console.error(
        `[upload] ${name} attempt ${attempt + 1}/${UPLOAD_MAX_RETRIES + 1} failed:`,
        err,
      );

      if (attempt < UPLOAD_MAX_RETRIES) {
        const delay = UPLOAD_RETRY_DELAYS[attempt];
        options?.onRetry?.(attempt + 1, UPLOAD_MAX_RETRIES + 1);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        // All retries exhausted
        throw new Error(
          `Upload failed after ${UPLOAD_MAX_RETRIES + 1} attempts: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error("Upload failed");
}

/**
 * Resume a pending upload from IndexedDB.
 * Used on page load to resume uploads that were interrupted.
 */
export async function resumePendingUpload(
  pending: PendingUpload,
  options?: {
    onRetry?: (attempt: number, maxAttempts: number) => void;
    onProgress?: (uploaded: boolean) => void;
  },
): Promise<UploadResult> {
  return uploadWithPersistence(pending.blob, pending.name, pending.visitId, {
    source: pending.source,
    onRetry: options?.onRetry,
    onProgress: options?.onProgress,
  });
}
