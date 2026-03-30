/**
 * AES-GCM encryption for IndexedDB blobs.
 * Protects PHI at rest — key stored in a separate IndexedDB store
 * so data survives tab close and browser restart.
 */

const KEY_DB_NAME = "meditalk-crypto";
const KEY_STORE_NAME = "keys";
const KEY_ID = "pending-uploads-key";
const KEY_DB_VERSION = 1;

function openKeyDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
        db.createObjectStore(KEY_STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/** Get existing key from IndexedDB or generate + store a new one. */
export async function getOrCreateKey(): Promise<CryptoKey> {
  const db = await openKeyDB();

  // Try to load existing key
  const existing = await new Promise<
    { id: string; jwk: JsonWebKey } | undefined
  >((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, "readonly");
    const store = tx.objectStore(KEY_STORE_NAME);
    const request = store.get(KEY_ID);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (existing?.jwk) {
    return crypto.subtle.importKey(
      "jwk",
      existing.jwk,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
  }

  // Generate new key and persist it
  const key = await generateKey();
  const jwk = await crypto.subtle.exportKey("jwk", key);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, "readwrite");
    const store = tx.objectStore(KEY_STORE_NAME);
    const request = store.put({ id: KEY_ID, jwk });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  return key;
}

/** Encrypt a Blob with AES-GCM. Returns ciphertext + random IV. */
export async function encryptBlob(
  blob: Blob,
  key: CryptoKey,
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array<ArrayBuffer> }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = await blob.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  return { ciphertext, iv };
}

/** Decrypt ciphertext back to a Blob. */
export async function decryptBlob(
  ciphertext: ArrayBuffer,
  iv: Uint8Array<ArrayBuffer>,
  key: CryptoKey,
  type: string,
): Promise<Blob> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new Blob([plaintext], { type });
}
