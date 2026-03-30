import { describe, it, expect, vi, beforeEach } from "vitest";
import { getOrCreateKey, encryptBlob, decryptBlob } from "./crypto";

// Mock IndexedDB for key storage
const mockKeyStore = new Map<string, unknown>();

const mockIDBStore = {
  get: vi.fn((key: string) => {
    const result = mockKeyStore.get(key);
    return { result, onsuccess: null as (() => void) | null, onerror: null };
  }),
  put: vi.fn((value: { id: string; jwk: JsonWebKey }) => {
    mockKeyStore.set(value.id, value);
    return { onsuccess: null as (() => void) | null, onerror: null };
  }),
};

const mockTransaction = {
  objectStore: vi.fn().mockReturnValue(mockIDBStore),
  oncomplete: null as (() => void) | null,
};

const mockDB = {
  transaction: vi.fn().mockReturnValue(mockTransaction),
  objectStoreNames: { contains: vi.fn().mockReturnValue(true) },
  createObjectStore: vi.fn(),
};

// Simulate IDB open
vi.stubGlobal("indexedDB", {
  open: vi.fn(() => {
    const request = {
      result: mockDB,
      error: null,
      onsuccess: null as ((event: unknown) => void) | null,
      onerror: null as (() => void) | null,
      onupgradeneeded: null as ((event: unknown) => void) | null,
    };
    // Resolve asynchronously
    queueMicrotask(() => {
      request.onsuccess?.({ target: request });
    });
    return request;
  }),
});

describe("crypto helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeyStore.clear();

    // Patch get/put to auto-resolve
    mockIDBStore.get.mockImplementation((key: string) => {
      const req = {
        result: mockKeyStore.get(key),
        onsuccess: null as (() => void) | null,
        onerror: null,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    });

    mockIDBStore.put.mockImplementation((value: { id: string }) => {
      mockKeyStore.set(value.id, value);
      const req = { onsuccess: null as (() => void) | null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    });
  });

  it("encrypt → decrypt roundtrip preserves data", async () => {
    const key = await getOrCreateKey();
    const original = new Blob(["Hello, patient data!"], {
      type: "text/plain",
    });

    const { ciphertext, iv } = await encryptBlob(original, key);

    // Ciphertext should be different from plaintext
    const ctBytes = new Uint8Array(ciphertext);
    const ptBytes = new Uint8Array(await original.arrayBuffer());
    expect(ctBytes).not.toEqual(ptBytes);

    // Decrypt should restore original
    const decrypted = await decryptBlob(ciphertext, iv, key, "text/plain");
    const decryptedText = await decrypted.text();
    expect(decryptedText).toBe("Hello, patient data!");
    expect(decrypted.type).toBe("text/plain");
  });

  it("encrypt → decrypt works with binary data", async () => {
    const key = await getOrCreateKey();
    const binaryData = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const original = new Blob([binaryData], {
      type: "application/octet-stream",
    });

    const { ciphertext, iv } = await encryptBlob(original, key);
    const decrypted = await decryptBlob(
      ciphertext,
      iv,
      key,
      "application/octet-stream",
    );

    const result = new Uint8Array(await decrypted.arrayBuffer());
    expect(result).toEqual(binaryData);
  });

  it("different encryptions produce different ciphertexts (unique IV)", async () => {
    const key = await getOrCreateKey();
    const blob = new Blob(["same data"], { type: "text/plain" });

    const enc1 = await encryptBlob(blob, key);
    const enc2 = await encryptBlob(blob, key);

    // IVs should differ
    expect(enc1.iv).not.toEqual(enc2.iv);
    // Ciphertexts should differ (due to different IVs)
    expect(new Uint8Array(enc1.ciphertext)).not.toEqual(
      new Uint8Array(enc2.ciphertext),
    );
  });

  it("decryption fails with wrong key", async () => {
    const key1 = await getOrCreateKey();
    // Clear stored key to force a new one
    mockKeyStore.clear();
    const key2 = await getOrCreateKey();

    const blob = new Blob(["secret"], { type: "text/plain" });
    const { ciphertext, iv } = await encryptBlob(blob, key1);

    await expect(
      decryptBlob(ciphertext, iv, key2, "text/plain"),
    ).rejects.toThrow();
  });

  it("getOrCreateKey returns the same key on second call", async () => {
    const key1 = await getOrCreateKey();
    const key2 = await getOrCreateKey();

    // Export both and compare
    const jwk1 = await crypto.subtle.exportKey("jwk", key1);
    const jwk2 = await crypto.subtle.exportKey("jwk", key2);
    expect(jwk1.k).toBe(jwk2.k);
  });

  it("handles empty blob", async () => {
    const key = await getOrCreateKey();
    const empty = new Blob([], { type: "text/plain" });

    const { ciphertext, iv } = await encryptBlob(empty, key);
    const decrypted = await decryptBlob(ciphertext, iv, key, "text/plain");

    expect(decrypted.size).toBe(0);
  });

  it("handles large blob", async () => {
    const key = await getOrCreateKey();
    // 256KB of patterned data (getRandomValues has a 65536 byte limit)
    const data = new Uint8Array(256 * 1024);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const blob = new Blob([data], { type: "audio/webm" });

    const { ciphertext, iv } = await encryptBlob(blob, key);
    const decrypted = await decryptBlob(ciphertext, iv, key, "audio/webm");

    const result = new Uint8Array(await decrypted.arrayBuffer());
    expect(result).toEqual(data);
  });
});
