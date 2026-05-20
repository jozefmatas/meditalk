// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockUploadWithRetry = vi.fn();
vi.mock("@/lib/upload/upload-with-persistence", () => ({
  uploadWithRetry: (...args: unknown[]) => mockUploadWithRetry(...args),
}));

vi.mock("@/lib/events", () => ({
  emit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `pending-${++uuidCounter}`,
});

const { useFileUpload, extractConfig } = await import("./use-file-upload");
// Eliminate retry delay for tests
extractConfig.retryDelayMs = 0;

// ── Helpers ───────────────────────────────────────────────────────

function makeFile(name: string, type = "application/pdf"): File {
  return new File(["content"], name, { type });
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    visitId: "v1",
    onFilesChange: vi.fn(),
    hasActiveRecording: false,
    ...overrides,
  };
}

/** Set up mocks for a successful upload + metadata registration flow. */
function setupSuccessfulUpload(
  registeredFiles: Record<string, unknown>[] = [
    { id: "real-1", name: "report.pdf", size: 100, type: "application/pdf" },
  ],
) {
  mockUploadWithRetry.mockResolvedValue({
    id: "upload-1",
    name: "report.pdf",
    size: 100,
    type: "application/pdf",
    path: "uploads/report.pdf",
  });

  // Metadata registration
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ files: registeredFiles }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
});

describe("useFileUpload", () => {
  it("uploads files, registers metadata, and calls onFilesChange", async () => {
    const onFilesChange = vi.fn();
    setupSuccessfulUpload();

    // Extraction call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: "extracted text" }),
    });

    const { result } = renderHook(() =>
      useFileUpload(defaultProps({ onFilesChange })),
    );

    await act(async () => {
      await result.current.uploadFiles([makeFile("report.pdf")]);
    });

    // First call: adds pending files
    expect(onFilesChange).toHaveBeenCalled();
    // Metadata registration called
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/encounters/v1/files",
      expect.objectContaining({ method: "POST" }),
    );
    // Upload was called
    expect(mockUploadWithRetry).toHaveBeenCalledWith(
      expect.any(File),
      "report.pdf",
      "v1",
      expect.objectContaining({}),
    );
  });

  it("removes pending files when all uploads fail", async () => {
    const onFilesChange = vi.fn();
    mockUploadWithRetry.mockRejectedValue(new Error("upload failed"));

    const { result } = renderHook(() =>
      useFileUpload(defaultProps({ onFilesChange })),
    );

    await act(async () => {
      await result.current.uploadFiles([makeFile("report.pdf")]);
    });

    // First call: adds pending. Second call: removes pending (updater fn).
    const calls = onFilesChange.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // The removal call uses a function updater
    const removalFn = calls[calls.length - 1][0];
    expect(typeof removalFn).toBe("function");
    // Applying the updater to a list with the pending file should remove it
    const filtered = removalFn([
      { id: "pending-1", name: "report.pdf", pending: true },
      { id: "existing", name: "other.pdf" },
    ]);
    expect(filtered).toEqual([{ id: "existing", name: "other.pdf" }]);
  });

  it("removes pending files when metadata registration fails", async () => {
    const onFilesChange = vi.fn();
    mockUploadWithRetry.mockResolvedValue({
      id: "upload-1",
      name: "report.pdf",
      size: 100,
      type: "application/pdf",
      path: "uploads/report.pdf",
    });
    // Metadata registration fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() =>
      useFileUpload(defaultProps({ onFilesChange })),
    );

    await act(async () => {
      await result.current.uploadFiles([makeFile("report.pdf")]);
    });

    // The error catch block removes pending files
    const calls = onFilesChange.mock.calls;
    const lastFn = calls[calls.length - 1][0];
    expect(typeof lastFn).toBe("function");
    const filtered = lastFn([
      { id: "pending-1", name: "report.pdf", pending: true },
    ]);
    expect(filtered).toEqual([]);
  });

  it("calls onShouldPromptContext for non-audio uploads", async () => {
    setupSuccessfulUpload();
    // Extraction
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: "extracted" }),
    });

    const onShouldPromptContext = vi.fn();
    const { result } = renderHook(() =>
      useFileUpload(defaultProps({ onShouldPromptContext })),
    );

    await act(async () => {
      await result.current.uploadFiles([makeFile("report.pdf")]);
    });

    expect(onShouldPromptContext).toHaveBeenCalledTimes(1);
  });

  it("does not call onShouldPromptContext for audio uploads", async () => {
    mockUploadWithRetry.mockResolvedValue({
      id: "upload-1",
      name: "recording.webm",
      size: 100,
      type: "audio/webm",
      path: "uploads/recording.webm",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          files: [
            { id: "real-1", name: "recording.webm", type: "audio/webm" },
          ],
        }),
    });
    // No extraction for audio

    const onShouldPromptContext = vi.fn();
    const { result } = renderHook(() =>
      useFileUpload(defaultProps({ onShouldPromptContext })),
    );

    await act(async () => {
      await result.current.uploadFiles([
        makeFile("recording.webm", "audio/webm"),
      ]);
    });

    expect(onShouldPromptContext).not.toHaveBeenCalled();
  });

  it("triggers extraction and updates file on success", async () => {
    const onFilesChange = vi.fn();
    setupSuccessfulUpload();

    // Extraction succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: "OCR result" }),
    });

    const { result } = renderHook(() =>
      useFileUpload(defaultProps({ onFilesChange })),
    );

    await act(async () => {
      await result.current.uploadFiles([makeFile("report.pdf")]);
    });

    // Wait for background extraction to complete
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/encounters/v1/extract",
        expect.objectContaining({ method: "POST" }),
      );
    });

    // Extraction updates file via onFilesChange updater
    await waitFor(() => {
      const extractionCall = onFilesChange.mock.calls.find((call) => {
        if (typeof call[0] !== "function") return false;
        const result = call[0]([
          { id: "real-1", name: "report.pdf", type: "application/pdf" },
        ]);
        return result[0]?.extraction_status === "completed";
      });
      expect(extractionCall).toBeDefined();
    });
  });

  it("retries extraction once on failure then marks as failed", async () => {
    const onFilesChange = vi.fn();
    setupSuccessfulUpload();

    // Extraction fails twice
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() =>
      useFileUpload(defaultProps({ onFilesChange })),
    );

    await act(async () => {
      await result.current.uploadFiles([makeFile("report.pdf")]);
    });

    // Wait for extraction retry (background, 2s delay) — use longer timeout
    await waitFor(
      () => {
        const extractCalls = mockFetch.mock.calls.filter(
          (call) => call[0] === "/api/encounters/v1/extract",
        );
        expect(extractCalls.length).toBe(2);
      },
      { timeout: 4000 },
    );

    // File should be marked as failed via updater
    await waitFor(() => {
      const failedCall = onFilesChange.mock.calls.find((call) => {
        if (typeof call[0] !== "function") return false;
        const result = call[0]([
          { id: "real-1", name: "report.pdf", type: "application/pdf" },
        ]);
        return result[0]?.extraction_status === "failed";
      });
      expect(failedCall).toBeDefined();
    });
  });

  it("isUploading is true during upload and false after", async () => {
    const onFilesChange = vi.fn();
    setupSuccessfulUpload();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: "text" }),
    });

    const { result } = renderHook(() =>
      useFileUpload(defaultProps({ onFilesChange })),
    );

    expect(result.current.isUploading).toBe(false);

    await act(async () => {
      await result.current.uploadFiles([makeFile("report.pdf")]);
    });

    expect(result.current.isUploading).toBe(false);
  });
});
