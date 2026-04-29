import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isFileUploading,
  hasUploadingFiles,
  isFileExtracting,
  hasExtractingFiles,
  type EncounterFile,
} from "./file-state";

function makeFile(overrides: Partial<EncounterFile> = {}): EncounterFile {
  return {
    id: "f1",
    name: "test.pdf",
    size: 1024,
    type: "application/pdf",
    ...overrides,
  };
}

// ─── isFileUploading ────────────────────────────────────────────────

describe("isFileUploading", () => {
  it("returns true for a pending regular upload", () => {
    expect(isFileUploading(makeFile({ pending: true }))).toBe(true);
  });

  it("returns true for a pending recording-upload (audio uploaded during recording)", () => {
    expect(
      isFileUploading(makeFile({ pending: true, source: "recording-upload" })),
    ).toBe(true);
  });

  it("returns false for a completed upload", () => {
    expect(isFileUploading(makeFile({ pending: false }))).toBe(false);
  });

  it("returns false when pending is undefined", () => {
    expect(isFileUploading(makeFile())).toBe(false);
  });

  it("returns false for an active recording file (source === 'recording')", () => {
    expect(
      isFileUploading(
        makeFile({ pending: true, source: "recording", isRecording: true }),
      ),
    ).toBe(false);
  });

  it("returns false for a paused recording file (source === 'recording', isRecording false)", () => {
    expect(
      isFileUploading(
        makeFile({ pending: true, source: "recording", isRecording: false }),
      ),
    ).toBe(false);
  });
});

// ─── hasUploadingFiles ──────────────────────────────────────────────

describe("hasUploadingFiles", () => {
  it("returns false for an empty list", () => {
    expect(hasUploadingFiles([])).toBe(false);
  });

  it("returns false when no files are pending", () => {
    expect(
      hasUploadingFiles([
        makeFile({ id: "a", pending: false }),
        makeFile({ id: "b" }),
      ]),
    ).toBe(false);
  });

  it("returns true when at least one regular file is uploading", () => {
    expect(
      hasUploadingFiles([
        makeFile({ id: "a", pending: false }),
        makeFile({ id: "b", pending: true }),
      ]),
    ).toBe(true);
  });

  it("returns true when an audio-during-recording upload is still pending", () => {
    expect(
      hasUploadingFiles([
        makeFile({
          id: "a",
          pending: true,
          source: "recording-upload",
          type: "audio/mpeg",
        }),
      ]),
    ).toBe(true);
  });

  it("ignores the live recording file and returns false", () => {
    expect(
      hasUploadingFiles([
        makeFile({
          id: "rec",
          pending: true,
          source: "recording",
          isRecording: true,
          type: "audio/webm",
        }),
      ]),
    ).toBe(false);
  });

  it("returns true when one real upload is mixed with a live recording", () => {
    expect(
      hasUploadingFiles([
        makeFile({
          id: "rec",
          pending: true,
          source: "recording",
          isRecording: true,
        }),
        makeFile({ id: "pdf", pending: true }),
      ]),
    ).toBe(true);
  });
});

// ─── isFileExtracting ───────────────────────────────────────────────

describe("isFileExtracting", () => {
  it("returns false for a file still uploading (pending=true)", () => {
    expect(isFileExtracting(makeFile({ pending: true }))).toBe(false);
  });

  it("returns false for a recording file", () => {
    expect(isFileExtracting(makeFile({ source: "recording" }))).toBe(false);
  });

  it("returns false when extracted_text is present", () => {
    expect(isFileExtracting(makeFile({ extracted_text: "some text" }))).toBe(
      false,
    );
  });

  it("returns false when extraction_status is completed", () => {
    expect(isFileExtracting(makeFile({ extraction_status: "completed" }))).toBe(
      false,
    );
  });

  it("returns false when extraction_status is failed", () => {
    expect(isFileExtracting(makeFile({ extraction_status: "failed" }))).toBe(
      false,
    );
  });

  it("returns true when uploaded but no extracted_text and status is pending", () => {
    expect(
      isFileExtracting(
        makeFile({ pending: false, extraction_status: "pending" }),
      ),
    ).toBe(true);
  });

  it("returns true when uploaded but no extracted_text and status is extracting", () => {
    expect(
      isFileExtracting(
        makeFile({ pending: false, extraction_status: "extracting" }),
      ),
    ).toBe(true);
  });

  it("returns true when uploaded and extraction_status is undefined", () => {
    expect(
      isFileExtracting(
        makeFile({ pending: false, extraction_status: undefined }),
      ),
    ).toBe(true);
  });

  it("returns false when extraction has been running > 5 minutes (safety valve)", () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    expect(
      isFileExtracting(
        makeFile({
          pending: false,
          extraction_status: "extracting",
          extraction_started_at: sixMinutesAgo,
        }),
      ),
    ).toBe(false);
  });

  it("returns true when extraction started less than 5 minutes ago", () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    expect(
      isFileExtracting(
        makeFile({
          pending: false,
          extraction_status: "extracting",
          extraction_started_at: twoMinutesAgo,
        }),
      ),
    ).toBe(true);
  });
});

// ─── hasExtractingFiles ─────────────────────────────────────────────

describe("hasExtractingFiles", () => {
  it("returns false for an empty list", () => {
    expect(hasExtractingFiles([])).toBe(false);
  });

  it("returns false when all files have extracted_text", () => {
    expect(
      hasExtractingFiles([
        makeFile({ id: "a", extracted_text: "text a" }),
        makeFile({ id: "b", extracted_text: "text b" }),
      ]),
    ).toBe(false);
  });

  it("returns true when at least one file is extracting", () => {
    expect(
      hasExtractingFiles([
        makeFile({ id: "a", extracted_text: "text a" }),
        makeFile({
          id: "b",
          pending: false,
          extraction_status: "extracting",
        }),
      ]),
    ).toBe(true);
  });

  it("ignores recording files", () => {
    expect(
      hasExtractingFiles([makeFile({ id: "rec", source: "recording" })]),
    ).toBe(false);
  });

  it("returns false when the only extracting file has timed out", () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    expect(
      hasExtractingFiles([
        makeFile({
          id: "a",
          pending: false,
          extraction_status: "extracting",
          extraction_started_at: sixMinutesAgo,
        }),
      ]),
    ).toBe(false);
  });
});

// ─── awaitPendingExtractions ────────────────────────────────────────

describe("awaitPendingExtractions", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("resolves immediately when no files are extracting", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          metadata: {
            files: [{ id: "f1", name: "doc.pdf", extracted_text: "done" }],
          },
        }),
    });

    const { awaitPendingExtractions } = await import("./file-state");
    await awaitPendingExtractions("visit-1");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves immediately when fetch fails", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false });

    const { awaitPendingExtractions } = await import("./file-state");
    await awaitPendingExtractions("visit-1");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("polls until extraction completes", async () => {
    const extractingFile = {
      id: "f1",
      name: "doc.pdf",
      size: 1024,
      type: "application/pdf",
      pending: false,
      extraction_status: "extracting",
    };
    const completedFile = {
      ...extractingFile,
      extraction_status: "completed",
      extracted_text: "extracted content",
    };

    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ metadata: { files: [extractingFile] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ metadata: { files: [completedFile] } }),
      });

    const { awaitPendingExtractions } = await import("./file-state");
    const promise = awaitPendingExtractions("visit-1");

    // Advance past the 2s poll interval
    await vi.advanceTimersByTimeAsync(2500);
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
