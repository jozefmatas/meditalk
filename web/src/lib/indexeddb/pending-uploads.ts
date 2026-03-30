/**
 * IndexedDB storage for pending file uploads.
 * Ensures recordings and files are never lost — even if the browser crashes
 * or the user closes the tab, pending uploads are resumed on next visit.
 *
 * All blobs are encrypted with AES-GCM before storing (PHI at rest).
 */

import { getOrCreateKey, encryptBlob, decryptBlob } from "./crypto";

const DB_NAME = "meditalk-pending-uploads";
const STORE_NAME = "uploads";
const DB_VERSION = 2;

/** Public type — callers pass/receive plain blobs. */
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

/** Internal type stored in IndexedDB — blob replaced with encrypted fields. */
interface PendingUploadStored {
  id: string;
  visitId: string;
  ciphertext: ArrayBuffer;
  iv: Uint8Array<ArrayBuffer>;
  name: string;
  type: string;
  size: number;
  source?: string;
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Drop old store on upgrade — can't decrypt legacy unencrypted entries
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }

      const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("visitId", "visitId", { unique: false });
      store.createIndex("timestamp", "timestamp", { unique: false });

      // Block the transaction until the store is ready
      const tx = (event.target as IDBOpenDBRequest).transaction;
      if (tx) {
        tx.oncomplete = () => {};
      }
    };
  });
}

/** Decrypt a stored record back to a PendingUpload. Returns null if decryption fails. */
async function decryptRecord(
  record: PendingUploadStored,
  key: CryptoKey,
): Promise<PendingUpload | null> {
  try {
    const blob = await decryptBlob(
      record.ciphertext,
      record.iv,
      key,
      record.type,
    );
    return {
      id: record.id,
      visitId: record.visitId,
      blob,
      name: record.name,
      type: record.type,
      size: record.size,
      source: record.source,
      timestamp: record.timestamp,
    };
  } catch {
    console.warn(`[pending-uploads] Failed to decrypt ${record.id}, removing`);
    deletePendingUpload(record.id).catch(() => {});
    return null;
  }
}

/**
 * Save a pending upload to IndexedDB (encrypted).
 * Call this BEFORE attempting the upload so it's preserved on crash/refresh.
 */
export async function savePendingUpload(upload: PendingUpload): Promise<void> {
  const key = await getOrCreateKey();
  const { ciphertext, iv } = await encryptBlob(upload.blob, key);

  const stored: PendingUploadStored = {
    id: upload.id,
    visitId: upload.visitId,
    ciphertext,
    iv,
    name: upload.name,
    type: upload.type,
    size: upload.size,
    source: upload.source,
    timestamp: upload.timestamp,
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(stored);

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
  const [db, key] = await Promise.all([openDB(), getOrCreateKey()]);

  const records: PendingUploadStored[] = await new Promise(
    (resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("visitId");
      const request = index.getAll(visitId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    },
  );

  const results = await Promise.all(records.map((r) => decryptRecord(r, key)));
  return results.filter((r): r is PendingUpload => r !== null);
}

/**
 * Get ALL pending uploads across all visits.
 * Useful for showing a global "pending uploads" indicator.
 */
export async function getAllPendingUploads(): Promise<PendingUpload[]> {
  const [db, key] = await Promise.all([openDB(), getOrCreateKey()]);

  const records: PendingUploadStored[] = await new Promise(
    (resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    },
  );

  const results = await Promise.all(records.map((r) => decryptRecord(r, key)));
  return results.filter((r): r is PendingUpload => r !== null);
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
  const db = await openDB();

  const ids: string[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("visitId");
    const request = index.getAllKeys(visitId);

    request.onsuccess = () => resolve(request.result as string[]);
    request.onerror = () => reject(request.error);
  });

  if (ids.length === 0) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    let completed = 0;
    ids.forEach((id) => {
      const request = store.delete(id);
      request.onsuccess = () => {
        completed++;
        if (completed === ids.length) resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Clear old pending uploads (older than 24 hours by default).
 * Call this periodically to prevent IndexedDB bloat from abandoned uploads.
 * Normal uploads are deleted immediately on success — this only catches
 * entries where all retries failed and the user never returned.
 */
export async function clearOldPendingUploads(
  maxAgeMs = 24 * 60 * 60 * 1000,
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
