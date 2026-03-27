import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadWithPersistence, resumePendingUpload } from "./upload-with-persistence";
import type { PendingUpload } from "@/lib/indexeddb/pending-uploads";

// Mock the dependencies
vi.mock("@/lib/supabase/upload", () => ({
  uploadToStorage: vi.fn(),
}));

vi.mock("@/lib/indexeddb/pending-uploads", () => ({
  savePendingUpload: vi.fn().mockResolvedValue(undefined),
  deletePendingUpload: vi.fn().mockResolvedValue(undefined),
}));

import { uploadToStorage } from "@/lib/supabase/upload";
import {
  savePendingUpload,
  deletePendingUpload,
} from "@/lib/indexeddb/pending-uploads";

describe("uploadWithPersistence", () => {
  const mockBlob = new Blob(["test content"], { type: "text/plain" });
  const mockFileName = "test.txt";
  const mockVisitId = "visit-123";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset mocks to default resolved state
    vi.mocked(uploadToStorage).mockResolvedValue({
      path: "uploads/test.txt",
      fileId: "file-123",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves to IndexedDB before upload attempt", async () => {
    vi.mocked(uploadToStorage).mockResolvedValue({
      path: "uploads/test.txt",
      fileId: "file-123",
    });

    const promise = uploadWithPersistence(
      mockBlob,
      mockFileName,
      mockVisitId,
    );

    // Let savePendingUpload be called
    await vi.runOnlyPendingTimersAsync();

    expect(savePendingUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        visitId: mockVisitId,
        blob: mockBlob,
        name: mockFileName,
        type: "text/plain",
        size: mockBlob.size,
      }),
    );

    await promise;
  });

  it("uploads successfully on first attempt", async () => {
    vi.mocked(uploadToStorage).mockResolvedValue({
      path: "uploads/test.txt",
      fileId: "file-123",
    });

    const result = await uploadWithPersistence(
      mockBlob,
      mockFileName,
      mockVisitId,
    );

    expect(result).toEqual({
      id: "file-123",
      name: mockFileName,
      size: mockBlob.size,
      type: "text/plain",
      path: "uploads/test.txt",
      source: undefined,
    });

    expect(uploadToStorage).toHaveBeenCalledTimes(1);
    expect(deletePendingUpload).toHaveBeenCalled();
  });

  it("retries on failure and succeeds", async () => {
    vi.mocked(uploadToStorage)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValue({
        path: "uploads/test.txt",
        fileId: "file-123",
      });

    const onRetry = vi.fn();

    const promise = uploadWithPersistence(
      mockBlob,
      mockFileName,
      mockVisitId,
      { onRetry },
    );

    // Fast-forward through retry delays
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result.id).toBe("file-123");
    expect(uploadToStorage).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledWith(1, 11); // First retry attempt
    expect(onRetry).toHaveBeenCalledWith(2, 11); // Second retry attempt
    expect(deletePendingUpload).toHaveBeenCalled();
  });

  it("throws after exhausting all retries", async () => {
    vi.mocked(uploadToStorage).mockRejectedValue(
      new Error("Persistent failure"),
    );

    const promise = uploadWithPersistence(
      mockBlob,
      mockFileName,
      mockVisitId,
    );

    // Fast-forward through all retry delays
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("Upload failed after 11 attempts");
    expect(uploadToStorage).toHaveBeenCalledTimes(11); // Initial + 10 retries
    expect(deletePendingUpload).not.toHaveBeenCalled(); // Should NOT delete on failure
  });

  it("includes source in upload result when provided", async () => {
    vi.mocked(uploadToStorage).mockResolvedValue({
      path: "uploads/recording.webm",
      fileId: "file-456",
    });

    const result = await uploadWithPersistence(
      mockBlob,
      "recording.webm",
      mockVisitId,
      { source: "recording" },
    );

    expect(result.source).toBe("recording");
  });

  it("calls onProgress callback on success", async () => {
    vi.mocked(uploadToStorage).mockResolvedValue({
      path: "uploads/test.txt",
      fileId: "file-123",
    });

    const onProgress = vi.fn();

    await uploadWithPersistence(mockBlob, mockFileName, mockVisitId, {
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith(true);
  });

  it("continues if IndexedDB save fails", async () => {
    vi.mocked(savePendingUpload).mockRejectedValue(
      new Error("IndexedDB error"),
    );
    vi.mocked(uploadToStorage).mockResolvedValue({
      path: "uploads/test.txt",
      fileId: "file-123",
    });

    // Should not throw — continues with direct upload
    const result = await uploadWithPersistence(
      mockBlob,
      mockFileName,
      mockVisitId,
    );

    expect(result.id).toBe("file-123");
  });

  it("uses exponential backoff delays", async () => {
    vi.mocked(uploadToStorage)
      .mockRejectedValueOnce(new Error("Fail 1"))
      .mockRejectedValueOnce(new Error("Fail 2"))
      .mockRejectedValueOnce(new Error("Fail 3"))
      .mockResolvedValue({
        path: "uploads/test.txt",
        fileId: "file-123",
      });

    const delays: number[] = [];
    const originalSetTimeout = setTimeout;

    vi.spyOn(global, "setTimeout").mockImplementation(((
      fn: () => void,
      delay: number,
    ) => {
      delays.push(delay);
      return originalSetTimeout(fn, 0);
    }) as typeof setTimeout);

    const promise = uploadWithPersistence(
      mockBlob,
      mockFileName,
      mockVisitId,
    );

    await vi.runAllTimersAsync();
    await promise;

    // Verify delays match UPLOAD_RETRY_DELAYS: [2000, 3000, 5000, ...]
    expect(delays[0]).toBe(2000);
    expect(delays[1]).toBe(3000);
    expect(delays[2]).toBe(5000);
  });
});

describe("resumePendingUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset default upload mock
    vi.mocked(uploadToStorage).mockResolvedValue({
      path: "uploads/resumed.webm",
      fileId: "file-789",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resumes upload from pending state", async () => {
    const blob = new Blob(["resumed content"], { type: "audio/webm" });

    const pending: PendingUpload = {
      id: "pending-123",
      visitId: "visit-456",
      blob,
      name: "resumed.webm",
      type: "audio/webm",
      size: blob.size,
      source: "recording",
      timestamp: Date.now(),
    };

    const result = await resumePendingUpload(pending);

    expect(result).toEqual({
      id: "file-789",
      name: "resumed.webm",
      size: blob.size,
      type: "audio/webm",
      path: "uploads/resumed.webm",
      source: "recording",
    });

    expect(uploadToStorage).toHaveBeenCalledWith(
      pending.blob,
      pending.name,
      expect.objectContaining({
        encounterId: pending.visitId,
      }),
    );
  });

  it("forwards callbacks to uploadWithPersistence", async () => {
    vi.mocked(uploadToStorage)
      .mockRejectedValueOnce(new Error("Retry test"))
      .mockResolvedValue({
        path: "uploads/test.webm",
        fileId: "file-999",
      });

    const onRetry = vi.fn();
    const onProgress = vi.fn();

    const blob = new Blob(["test"], { type: "audio/webm" });

    const pending: PendingUpload = {
      id: "pending-456",
      visitId: "visit-789",
      blob,
      name: "test.webm",
      type: "audio/webm",
      size: blob.size,
      timestamp: Date.now(),
    };

    const promise = resumePendingUpload(pending, { onRetry, onProgress });

    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledWith(1, 11);
    expect(onProgress).toHaveBeenCalledWith(true);
  });
});
