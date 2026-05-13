// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────

const mockUploadToStorage = vi.fn();
vi.mock("@/lib/supabase/upload", () => ({
  uploadToStorage: (...args: unknown[]) => mockUploadToStorage(...args),
}));

const mockPatchEncounter = vi.fn();
vi.mock("@/lib/encounters/api", () => ({
  patchEncounter: (...args: unknown[]) => mockPatchEncounter(...args),
}));

const mockTranscribeBlob = vi.fn();
const mockTranscribeFromPath = vi.fn();
vi.mock("@/components/encounters/hooks/transcribe-blob", () => ({
  transcribeBlob: (...args: unknown[]) => mockTranscribeBlob(...args),
  transcribeFromPath: (...args: unknown[]) => mockTranscribeFromPath(...args),
}));

vi.mock("@/lib/audio/mime-utils", () => ({
  audioMimeToExt: (mime: string) => (mime.includes("mp4") ? ".m4a" : ".webm"),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { persistRecordingSnapshot } =
  await import("./persist-recording-snapshot");

// ── Helpers ───────────────────────────────────────────────────────

function makeBlob(type = "audio/webm"): Blob {
  return new Blob(["audio-data"], { type });
}

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistRecordingSnapshot", () => {
  it("uploads blob and persists session metadata", async () => {
    mockUploadToStorage.mockResolvedValue({
      path: "recordings/v1/recording.webm",
      fileId: "file-1",
    });
    mockPatchEncounter.mockResolvedValue({ ok: true });

    const result = await persistRecordingSnapshot({
      blob: makeBlob(),
      visitId: "v1",
      durationSeconds: 120,
    });

    expect(result.storagePath).toBe("recordings/v1/recording.webm");
    expect(mockUploadToStorage).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.stringContaining("recording"),
      expect.objectContaining({ encounterId: "v1" }),
    );
    expect(mockPatchEncounter).toHaveBeenCalledWith("v1", {
      metadata: {
        recording_session: {
          state: "paused",
          durationAtPause: 120,
          audioPath: "recordings/v1/recording.webm",
          snapshotBytes: expect.any(Number),
          snapshotVersion: expect.any(Number),
        },
      },
    });
  });

  it("throws when upload fails", async () => {
    mockUploadToStorage.mockRejectedValue(new Error("upload failed"));

    await expect(
      persistRecordingSnapshot({
        blob: makeBlob(),
        visitId: "v1",
        durationSeconds: 60,
      }),
    ).rejects.toThrow("upload failed");

    // Should not attempt to persist session metadata
    expect(mockPatchEncounter).not.toHaveBeenCalled();
  });

  it("uses transcribeBlob for web when language provided", async () => {
    mockUploadToStorage.mockResolvedValue({
      path: "recordings/v1/rec.webm",
      fileId: "file-1",
    });
    mockPatchEncounter.mockResolvedValue({ ok: true });
    mockTranscribeBlob.mockResolvedValue("transcribed text");

    await persistRecordingSnapshot({
      blob: makeBlob(),
      visitId: "v1",
      durationSeconds: 60,
      language: "sk",
      isNative: false,
    });

    // Allow fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(mockTranscribeBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "sk",
      "v1",
    );
    expect(mockTranscribeFromPath).not.toHaveBeenCalled();
  });

  it("uses transcribeFromPath for native when language provided", async () => {
    mockUploadToStorage.mockResolvedValue({
      path: "recordings/v1/rec.webm",
      fileId: "file-1",
    });
    mockPatchEncounter.mockResolvedValue({ ok: true });
    mockTranscribeFromPath.mockResolvedValue("native transcript");

    await persistRecordingSnapshot({
      blob: makeBlob(),
      visitId: "v1",
      durationSeconds: 60,
      language: "en",
      isNative: true,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockTranscribeFromPath).toHaveBeenCalledWith(
      "recordings/v1/rec.webm",
      "en",
      "v1",
    );
    expect(mockTranscribeBlob).not.toHaveBeenCalled();
  });

  it("saves transcript via patchEncounter after transcription", async () => {
    mockUploadToStorage.mockResolvedValue({
      path: "recordings/v1/rec.webm",
      fileId: "file-1",
    });
    mockPatchEncounter.mockResolvedValue({ ok: true });
    mockTranscribeBlob.mockResolvedValue("the transcript");

    await persistRecordingSnapshot({
      blob: makeBlob(),
      visitId: "v1",
      durationSeconds: 60,
      language: "sk",
    });

    await new Promise((r) => setTimeout(r, 10));

    // First call: session metadata. Second call: transcript + version.
    expect(mockPatchEncounter).toHaveBeenCalledTimes(2);
    const sessionCall = mockPatchEncounter.mock.calls[0][1];
    const snapshotVersion =
      sessionCall.metadata.recording_session.snapshotVersion;
    expect(mockPatchEncounter).toHaveBeenLastCalledWith("v1", {
      metadata: {
        transcript: "the transcript",
        transcriptSnapshotVersion: snapshotVersion,
      },
    });
  });

  it("skips transcription when no language provided", async () => {
    mockUploadToStorage.mockResolvedValue({
      path: "recordings/v1/rec.webm",
      fileId: "file-1",
    });
    mockPatchEncounter.mockResolvedValue({ ok: true });

    await persistRecordingSnapshot({
      blob: makeBlob(),
      visitId: "v1",
      durationSeconds: 60,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockTranscribeBlob).not.toHaveBeenCalled();
    expect(mockTranscribeFromPath).not.toHaveBeenCalled();
    // Only session metadata patch, no transcript patch
    expect(mockPatchEncounter).toHaveBeenCalledTimes(1);
  });
});
