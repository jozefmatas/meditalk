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

vi.mock("@/lib/encounters/sources", () => ({
  getTranscript: vi.fn(),
}));

vi.mock("./use-audio-recorder", () => ({
  audioMimeToExt: vi.fn().mockReturnValue(".webm"),
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { usePreGeneration } = await import("./use-pre-generation");
const { transcribeBlob, transcribeFromPath } = await import(
  "./transcribe-blob"
);
const { uploadToStorage } = await import("@/lib/supabase/upload");
const { getTranscript } = await import("@/lib/encounters/sources");
const { toast } = await import("sonner");

// ── Helpers ────────────────────────────────────────────────────────

function makeVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    user_id: "u1",
    title: null,
    audio_path: null,
    language: "sk",
    visit_date: "2025-01-15",
    patient_name: null,
    patient_id: null,
    visit_type: "consultation" as const,
    status: "started" as const,
    encounter_note: null,
    metadata: {} as Record<string, unknown>,
    created_at: "2025-01-15T00:00:00Z",
    ...overrides,
  };
}

function makeRecordingBarRef(
  overrides: Record<string, unknown> = {},
) {
  return {
    current: {
      finalize: vi.fn().mockResolvedValue({
        blob: null,
        isRestoredSession: false,
      }),
      releaseGuards: vi.fn(),
      ...overrides,
    },
  } as unknown as React.RefObject<{
    finalize: () => Promise<{ blob: Blob | null; isRestoredSession: boolean }>;
    releaseGuards?: () => void;
  } | null>;
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePreGeneration", () => {
  describe("prepareSource — finalization", () => {
    it("uses pre-finalized recording when provided", async () => {
      const blob = new Blob(["audio"], { type: "audio/webm" });
      (uploadToStorage as ReturnType<typeof vi.fn>).mockResolvedValue({
        path: "uploads/v1/recovery.webm",
      });
      (transcribeFromPath as ReturnType<typeof vi.fn>).mockResolvedValue(
        "Hello doctor",
      );

      const { result } = renderHook(() => usePreGeneration("v1"));
      const ref = makeRecordingBarRef();

      const out = await result.current.prepareSource({
        recordingBarRef: ref as never,
        language: "en",
        visit: makeVisit(),
        finalized: { blob, isRestoredSession: false },
      });

      // Should NOT have called finalize on the ref
      expect(ref.current!.finalize).not.toHaveBeenCalled();
      expect(out.transcriptText).toBe("Hello doctor");
    });

    it("falls back to recordingBarRef.finalize when no pre-finalized data", async () => {
      const blob = new Blob(["audio"], { type: "audio/webm" });
      const ref = makeRecordingBarRef({
        finalize: vi.fn().mockResolvedValue({
          blob,
          isRestoredSession: false,
        }),
      });
      (uploadToStorage as ReturnType<typeof vi.fn>).mockResolvedValue({
        path: "uploads/v1/recovery.webm",
      });
      (transcribeFromPath as ReturnType<typeof vi.fn>).mockResolvedValue(
        "Inline transcript",
      );

      const { result } = renderHook(() => usePreGeneration("v1"));

      const out = await result.current.prepareSource({
        recordingBarRef: ref as never,
        language: "en",
        visit: makeVisit(),
      });

      expect(ref.current!.finalize).toHaveBeenCalled();
      expect(out.transcriptText).toBe("Inline transcript");
    });
  });

  describe("prepareSource — transcription paths", () => {
    it("transcribes from storage path when upload succeeds", async () => {
      const blob = new Blob(["audio"], { type: "audio/webm" });
      (uploadToStorage as ReturnType<typeof vi.fn>).mockResolvedValue({
        path: "uploads/v1/recovery.webm",
      });
      (transcribeFromPath as ReturnType<typeof vi.fn>).mockResolvedValue(
        "From path",
      );

      const { result } = renderHook(() => usePreGeneration("v1"));

      const out = await result.current.prepareSource({
        recordingBarRef: makeRecordingBarRef() as never,
        language: "sk",
        visit: makeVisit(),
        finalized: { blob, isRestoredSession: false },
      });

      expect(transcribeFromPath).toHaveBeenCalledWith(
        "uploads/v1/recovery.webm",
        "sk",
        "v1",
      );
      expect(transcribeBlob).not.toHaveBeenCalled();
      expect(out.transcriptText).toBe("From path");
    });

    it("falls back to transcribeBlob when storage path transcription fails", async () => {
      const blob = new Blob(["audio"], { type: "audio/webm" });
      (uploadToStorage as ReturnType<typeof vi.fn>).mockResolvedValue({
        path: "uploads/v1/recovery.webm",
      });
      (transcribeFromPath as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (transcribeBlob as ReturnType<typeof vi.fn>).mockResolvedValue(
        "From blob",
      );

      const { result } = renderHook(() => usePreGeneration("v1"));

      const out = await result.current.prepareSource({
        recordingBarRef: makeRecordingBarRef() as never,
        language: "en",
        visit: makeVisit(),
        finalized: { blob, isRestoredSession: false },
      });

      expect(transcribeFromPath).toHaveBeenCalled();
      expect(transcribeBlob).toHaveBeenCalledWith(blob, "en", "v1");
      expect(out.transcriptText).toBe("From blob");
    });

    it("uses transcribeBlob directly when upload fails", async () => {
      const blob = new Blob(["audio"], { type: "audio/webm" });
      (uploadToStorage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Upload failed"),
      );
      (transcribeBlob as ReturnType<typeof vi.fn>).mockResolvedValue(
        "Direct blob",
      );

      const { result } = renderHook(() => usePreGeneration("v1"));

      const out = await result.current.prepareSource({
        recordingBarRef: makeRecordingBarRef() as never,
        language: "en",
        visit: makeVisit(),
        finalized: { blob, isRestoredSession: false },
      });

      expect(transcribeFromPath).not.toHaveBeenCalled();
      expect(transcribeBlob).toHaveBeenCalledWith(blob, "en", "v1");
      expect(out.transcriptText).toBe("Direct blob");
    });

    it("uses getTranscript from visit metadata when no blob", async () => {
      (getTranscript as ReturnType<typeof vi.fn>).mockReturnValue(
        "Existing transcript",
      );

      const visit = makeVisit({ metadata: { transcript: "Existing" } });
      const { result } = renderHook(() => usePreGeneration("v1"));

      const out = await result.current.prepareSource({
        recordingBarRef: makeRecordingBarRef() as never,
        language: "en",
        visit,
        finalized: { blob: null, isRestoredSession: false },
      });

      expect(getTranscript).toHaveBeenCalledWith(visit.metadata);
      expect(out.transcriptText).toBe("Existing transcript");
    });
  });

  describe("prepareSource — toast warnings", () => {
    it("shows info toast when transcription fails but upload succeeded", async () => {
      const blob = new Blob(["audio"], { type: "audio/webm" });
      (uploadToStorage as ReturnType<typeof vi.fn>).mockResolvedValue({
        path: "uploads/v1/recovery.webm",
      });
      (transcribeFromPath as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (transcribeBlob as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { result } = renderHook(() => usePreGeneration("v1"));

      await result.current.prepareSource({
        recordingBarRef: makeRecordingBarRef() as never,
        language: "en",
        visit: makeVisit(),
        finalized: { blob, isRestoredSession: false },
      });

      expect(toast.info).toHaveBeenCalled();
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it("shows warning toast when transcription and upload both fail", async () => {
      const blob = new Blob(["audio"], { type: "audio/webm" });
      (uploadToStorage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("fail"),
      );
      (transcribeBlob as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { result } = renderHook(() => usePreGeneration("v1"));

      await result.current.prepareSource({
        recordingBarRef: makeRecordingBarRef() as never,
        language: "en",
        visit: makeVisit(),
        finalized: { blob, isRestoredSession: false },
      });

      expect(toast.warning).toHaveBeenCalled();
      expect(toast.info).not.toHaveBeenCalled();
    });
  });

  describe("prepareSource — audio recovery path", () => {
    it("returns generation_pending audioPath when no blob", async () => {
      (getTranscript as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const visit = makeVisit({
        metadata: {
          generation_pending: { audioPath: "pending/audio.webm" },
        },
      });
      const { result } = renderHook(() => usePreGeneration("v1"));

      const out = await result.current.prepareSource({
        recordingBarRef: makeRecordingBarRef() as never,
        language: "en",
        visit,
        finalized: { blob: null, isRestoredSession: false },
      });

      expect(out.audioRecoveryPath).toBe("pending/audio.webm");
    });

    it("returns uploaded path when transcription fails and blob was uploaded", async () => {
      const blob = new Blob(["audio"], { type: "audio/webm" });
      (uploadToStorage as ReturnType<typeof vi.fn>).mockResolvedValue({
        path: "uploads/v1/recovery.webm",
      });
      (transcribeFromPath as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (transcribeBlob as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { result } = renderHook(() => usePreGeneration("v1"));

      const out = await result.current.prepareSource({
        recordingBarRef: makeRecordingBarRef() as never,
        language: "en",
        visit: makeVisit(),
        finalized: { blob, isRestoredSession: false },
      });

      expect(out.audioRecoveryPath).toBe("uploads/v1/recovery.webm");
    });

    it("returns session audioPath for restored sessions", async () => {
      const blob = new Blob(["audio"], { type: "audio/webm" });
      (uploadToStorage as ReturnType<typeof vi.fn>).mockResolvedValue({
        path: "uploads/v1/recovery.webm",
      });
      (transcribeFromPath as ReturnType<typeof vi.fn>).mockResolvedValue(
        "transcript text",
      );

      const visit = makeVisit({
        metadata: {
          recording_session: {
            state: "recording",
            durationAtPause: 0,
            audioPath: "session/audio.webm",
          },
        },
      });
      const { result } = renderHook(() => usePreGeneration("v1"));

      const out = await result.current.prepareSource({
        recordingBarRef: makeRecordingBarRef() as never,
        language: "en",
        visit,
        finalized: { blob, isRestoredSession: true },
      });

      expect(out.audioRecoveryPath).toBe("session/audio.webm");
    });
  });
});
