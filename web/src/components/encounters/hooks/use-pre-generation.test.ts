// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("./transcribe-blob", () => ({
  transcribeBlob: vi.fn(),
  transcribeFromPath: vi.fn(),
}));

vi.mock("@/lib/supabase/upload", () => ({
  uploadToStorage: vi.fn(),
}));

vi.mock("./use-audio-recorder", () => ({
  audioMimeToExt: vi.fn().mockReturnValue(".webm"),
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { transcribeBlob, transcribeFromPath } =
  await import("./transcribe-blob");
const { uploadToStorage } = await import("@/lib/supabase/upload");

const mockTranscribeBlob = vi.mocked(transcribeBlob);
const mockTranscribeFromPath = vi.mocked(transcribeFromPath);
const mockUploadToStorage = vi.mocked(uploadToStorage);

// Import after mocks are set up
const { usePreGeneration } = await import("./use-pre-generation");

// ── Helpers ───────────────────────────────────────────────────────

function makeBlob(size = 1024): Blob {
  return new Blob([new ArrayBuffer(size)], { type: "audio/webm" });
}

const emptyRecordingBarRef = { current: null };

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockUploadToStorage.mockResolvedValue({
    path: "user-1/v1/abc-recovery.webm",
    fileId: "abc",
  });
});

describe("usePreGeneration", () => {
  it("uploads blob and returns null transcript + audioRecoveryPath", async () => {
    const { result } = renderHook(() => usePreGeneration("v1"));
    const blob = makeBlob();

    const output = await result.current.prepareSource({
      recordingBarRef: emptyRecordingBarRef,
      language: "sk",
      visit: null,
      finalized: { blob, isRestoredSession: false },
    });

    // Upload was called
    expect(mockUploadToStorage).toHaveBeenCalledOnce();

    // Transcription was NOT called (server handles this)
    expect(mockTranscribeFromPath).not.toHaveBeenCalled();
    expect(mockTranscribeBlob).not.toHaveBeenCalled();

    // Client always returns null transcript — server reads from DB
    expect(output.transcriptText).toBeNull();
    expect(output.audioRecoveryPath).toBe("user-1/v1/abc-recovery.webm");
  });

  it("returns null transcript even when blob matches snapshot and versions match", async () => {
    // Server-side polling handles transcript reuse now — client never sends transcript
    const { result } = renderHook(() => usePreGeneration("v1"));
    const blob = makeBlob(1024);

    const output = await result.current.prepareSource({
      recordingBarRef: emptyRecordingBarRef,
      language: "sk",
      visit: {
        id: "v1",
        metadata: {
          transcript: "paused transcript",
          transcriptSnapshotVersion: 1000,
          recording_session: {
            state: "paused",
            audioPath: "user-1/v1/snapshot.webm",
            snapshotBytes: 1024,
            snapshotVersion: 1000,
          },
        },
      } as never,
      finalized: { blob, isRestoredSession: false },
    });

    // Still uploads blob (for crash recovery)
    expect(mockUploadToStorage).toHaveBeenCalledOnce();

    // Client returns null transcript — server will poll for it
    expect(output.transcriptText).toBeNull();
    expect(output.audioRecoveryPath).toBe("user-1/v1/abc-recovery.webm");
  });

  it("returns no audioRecoveryPath when no blob and no metadata audio paths", async () => {
    const { result } = renderHook(() => usePreGeneration("v1"));

    const output = await result.current.prepareSource({
      recordingBarRef: emptyRecordingBarRef,
      language: "sk",
      visit: { id: "v1", metadata: {} } as never,
      finalized: { blob: null, isRestoredSession: false },
    });

    expect(mockUploadToStorage).not.toHaveBeenCalled();
    expect(output.transcriptText).toBeNull();
    expect(output.audioRecoveryPath).toBeUndefined();
  });

  it("returns metadata audioPath when no blob and generation_pending exists", async () => {
    const { result } = renderHook(() => usePreGeneration("v1"));

    const output = await result.current.prepareSource({
      recordingBarRef: emptyRecordingBarRef,
      language: "sk",
      visit: {
        id: "v1",
        metadata: {
          generation_pending: { audioPath: "user-1/v1/pending.webm" },
        },
      } as never,
      finalized: { blob: null, isRestoredSession: false },
    });

    expect(output.transcriptText).toBeNull();
    expect(output.audioRecoveryPath).toBe("user-1/v1/pending.webm");
  });

  it("returns session audioPath when no blob and recording_session exists", async () => {
    const { result } = renderHook(() => usePreGeneration("v1"));

    const output = await result.current.prepareSource({
      recordingBarRef: emptyRecordingBarRef,
      language: "sk",
      visit: {
        id: "v1",
        metadata: {
          recording_session: {
            state: "paused",
            audioPath: "user-1/v1/session.webm",
          },
        },
      } as never,
      finalized: { blob: null, isRestoredSession: false },
    });

    expect(output.transcriptText).toBeNull();
    expect(output.audioRecoveryPath).toBe("user-1/v1/session.webm");
  });

  it("falls back to session audioPath when blob upload fails", async () => {
    mockUploadToStorage.mockRejectedValue(new Error("upload failed"));

    const { result } = renderHook(() => usePreGeneration("v1"));
    const blob = makeBlob();

    const output = await result.current.prepareSource({
      recordingBarRef: emptyRecordingBarRef,
      language: "sk",
      visit: {
        id: "v1",
        metadata: {
          recording_session: {
            state: "paused",
            audioPath: "user-1/v1/session.webm",
          },
        },
      } as never,
      finalized: { blob, isRestoredSession: false },
    });

    expect(output.transcriptText).toBeNull();
    expect(output.audioRecoveryPath).toBe("user-1/v1/session.webm");
  });
});
