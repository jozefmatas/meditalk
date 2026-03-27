/**
 * IndexedDB storage for pending file uploads.
 * Ensures recordings and files are never lost — even if the browser crashes
 * or the user closes the tab, pending uploads are resumed on next visit.
 */

const DB_NAME = "meditalk-pending-uploads";
const STORE_NAME = "uploads";
const DB_VERSION = 1;

export interface PendingUpload {
  /** Unique ID for this upload (also the IndexedDB key) */
  id: string;
  /** Visit/encounter ID this upload belongs to */
  visitId: string;
  /** The file blob to upload */
  blob: Blob;
  /** Original filename */
  name: string;
  /** MIME type */
  type: string;
  /** File size in bytes */
  size: number;
  /** Source identifier (e.g., "recording", undefined for manual uploads) */
  source?: string;
  /** Timestamp when this upload was queued */
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Create object store with 'id' as the key path
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        // Index by visitId for efficient querying
        store.createIndex("visitId", "visitId", { unique: false });
        // Index by timestamp for cleanup
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
  });
}

/**
 * Save a pending upload to IndexedDB.
 * Call this BEFORE attempting the upload so it's preserved on crash/refresh.
 */
export async function savePendingUpload(upload: PendingUpload): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(upload);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all pending uploads for a specific visit/encounter.
 */
export async function getPendingUploadsForVisit(
  visitId: string,
): Promise<PendingUpload[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("visitId");
    const request = index.getAll(visitId);

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get ALL pending uploads across all visits.
 * Useful for showing a global "pending uploads" indicator.
 */
export async function getAllPendingUploads(): Promise<PendingUpload[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a pending upload after successful upload.
 */
export async function deletePendingUpload(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete all pending uploads for a specific visit.
 * Useful for cleanup after visit is deleted or completed.
 */
export async function deletePendingUploadsForVisit(
  visitId: string,
): Promise<void> {
  const uploads = await getPendingUploadsForVisit(visitId);
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    let completed = 0;
    if (uploads.length === 0) {
      resolve();
      return;
    }

    uploads.forEach((upload) => {
      const request = store.delete(upload.id);
      request.onsuccess = () => {
        completed++;
        if (completed === uploads.length) resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Clear old pending uploads (older than 7 days).
 * Call this periodically to prevent IndexedDB bloat from abandoned uploads.
 */
export async function clearOldPendingUploads(
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
): Promise<number> {
  const db = await openDB();
  const cutoff = Date.now() - maxAgeMs;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("timestamp");
    const range = IDBKeyRange.upperBound(cutoff);
    const request = index.openCursor(range);

    let deletedCount = 0;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>)
        .result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      } else {
        resolve(deletedCount);
      }
    };

    request.onerror = () => reject(request.error);
  });
}
