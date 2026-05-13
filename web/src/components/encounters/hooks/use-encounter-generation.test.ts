// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

const mockExecuteStream = vi.fn();
const mockRestoreFromCache = vi.fn().mockReturnValue(false);
const mockPrepareSource = vi.fn().mockResolvedValue({
  transcriptText: "test transcript",
  audioRecoveryPath: null,
  releaseGuards: vi.fn(),
});

vi.mock("./use-doctor-notes", () => ({
  useDoctorNotes: vi.fn().mockReturnValue({
    doctorNotes: "",
    setDoctorNotes: vi.fn(),
    saveStatus: "saved",
    initFromVisit: vi.fn(),
  }),
}));

vi.mock("./use-generation-stream", () => ({
  useGenerationStream: vi.fn().mockReturnValue({
    isStreaming: false,
    isGenerating: false,
    streamedSections: [],
    streamingSectionIds: [],
    streamingSectionLabels: {},
    executeStream: mockExecuteStream,
    resetStream: vi.fn(),
    restoreFromCache: mockRestoreFromCache,
  }),
  isGenerationActive: vi.fn().mockReturnValue(false),
}));

vi.mock("./use-pre-generation", () => ({
  usePreGeneration: vi.fn().mockReturnValue({
    prepareSource: mockPrepareSource,
  }),
}));

vi.mock("./use-template-cache", () => ({
  useTemplateCache: vi.fn().mockReturnValue({
    getCachedTemplate: vi.fn().mockReturnValue(null),
    setCachedTemplate: vi.fn(),
    clearCache: vi.fn(),
  }),
}));

vi.mock("./use-generation-polling", () => ({
  useGenerationPolling: vi.fn(),
}));

vi.mock("@/hooks/use-generation-timer", () => ({
  useGenerationTimer: vi.fn().mockReturnValue({
    elapsed: 0,
    estimated: 0,
    progress: 0,
  }),
}));

vi.mock("@/lib/templates", () => ({
  DEFAULT_TEMPLATE_ID: "default-template",
  getPreferredTemplateId: () => "default-template",
  setPreferredTemplateId: vi.fn(),
}));

vi.mock("@/lib/encounters/file-state", () => ({
  awaitPendingContextSave: vi.fn().mockResolvedValue(undefined),
  awaitPendingExtractions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/encounters/sources", () => ({
  getTranscript: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/encounters/api", () => ({
  patchEncounter: vi.fn().mockResolvedValue(new Response("ok")),
  patchEncounterStatus: vi.fn().mockResolvedValue(new Response("ok")),
}));

vi.mock("@/lib/events", () => ({
  emit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { useEncounterGeneration } = await import("./use-encounter-generation");
const { patchEncounter, patchEncounterStatus } =
  await import("@/lib/encounters/api");
const { emit } = await import("@/lib/events");
const { isGenerationActive } = await import("./use-generation-stream");

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
    metadata: {},
    created_at: "2025-01-15T00:00:00Z",
    ...overrides,
  };
}

const defaultOptions = () => ({
  visitId: "v1",
  visit: makeVisit(),
  setVisit: vi.fn(),
  setError: vi.fn(),
  updateTitle: vi.fn(),
  setFiles: vi.fn(),
});

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockExecuteStream.mockResolvedValue(null);
});

describe("useEncounterGeneration", () => {
  describe("handleRecordingStateChange", () => {
    it("sets hasActiveRecording and patches status", () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      act(() => {
        result.current.handleRecordingStateChange("recording");
      });

      expect(result.current.hasActiveRecording).toBe(true);
      expect(patchEncounterStatus).toHaveBeenCalledWith("v1", "recording");
    });

    it("skips PATCH when generation is active", () => {
      vi.mocked(isGenerationActive).mockReturnValue(true);
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      act(() => {
        result.current.handleRecordingStateChange("recording");
      });

      expect(patchEncounterStatus).not.toHaveBeenCalled();
      vi.mocked(isGenerationActive).mockReturnValue(false);
    });

    it("sets status to started when idle", () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      act(() => {
        result.current.handleRecordingStateChange("idle");
      });

      expect(result.current.hasActiveRecording).toBe(false);
    });
  });

  describe("handleGenerate", () => {
    it("calls prepareSource → processing → executeStream", async () => {
      const completedEvent = {
        generatedNote: "<p>Note</p>",
        suggestedTitle: "Auto Title",
      };
      mockExecuteStream.mockImplementation(async (params) => {
        params.onComplete?.(completedEvent);
        return completedEvent;
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      await act(async () => {
        await result.current.handleGenerate();
      });

      expect(mockPrepareSource).toHaveBeenCalledOnce();
      expect(emit).toHaveBeenCalledWith("encounter-update", {
        id: "v1",
        status: "processing",
      });
      expect(patchEncounter).toHaveBeenCalledWith(
        "v1",
        expect.objectContaining({ status: "processing" }),
      );
      expect(mockExecuteStream).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "/api/generate",
          retry: true,
        }),
      );
    });

    it("sets error and reverts status on insufficient_context", async () => {
      mockExecuteStream.mockRejectedValue(new Error("insufficient_context"));

      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      await act(async () => {
        await result.current.handleGenerate();
      });

      expect(opts.setError).toHaveBeenCalledWith("insufficient_context");
      expect(patchEncounterStatus).toHaveBeenCalledWith("v1", "started", {
        metadata: { generation_pending: null },
      });
    });

    it("sets error on save_failed", async () => {
      mockExecuteStream.mockRejectedValue(new Error("save_failed"));

      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      await act(async () => {
        await result.current.handleGenerate();
      });

      expect(opts.setError).toHaveBeenCalledWith("save_failed");
    });

    it("fires patchEncounter with to_review on completion", async () => {
      const completedEvent = {
        generatedNote: "<p>Note</p>",
        suggestedTitle: null,
      };
      mockExecuteStream.mockResolvedValue(completedEvent);

      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      // Set a title to prevent auto-title
      act(() => {
        result.current.syncTitle("My Title");
      });

      await act(async () => {
        await result.current.handleGenerate();
      });

      expect(patchEncounter).toHaveBeenCalledWith("v1", {
        status: "to_review",
      });
    });
  });

  describe("handleAdjustGenerate", () => {
    it("calls adjust endpoint with merged notes", async () => {
      const { useDoctorNotes } = await import("./use-doctor-notes");
      vi.mocked(useDoctorNotes).mockReturnValue({
        doctorNotes: "original notes",
        setDoctorNotes: vi.fn(),
        saveStatus: "saved" as const,
        initFromVisit: vi.fn(),
      });

      mockExecuteStream.mockResolvedValue(null);

      const opts = defaultOptions();
      const adjustRef = { current: null };
      const { result } = renderHook(() => useEncounterGeneration(opts));

      await act(async () => {
        await result.current.handleAdjustGenerate({
          adjustRecordingBarRef: adjustRef,
          additionalNotes: "extra note",
        });
      });

      expect(mockExecuteStream).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "/api/adjust",
          retry: false,
        }),
      );
    });
  });

  describe("handleRegenerate", () => {
    it("no-ops when same template selected", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      await act(async () => {
        await result.current.handleRegenerate("default-template");
      });

      expect(mockExecuteStream).not.toHaveBeenCalled();
    });

    it("streams via generate for uncached template", async () => {
      mockExecuteStream.mockResolvedValue(null);

      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      await act(async () => {
        await result.current.handleRegenerate("new-template");
      });

      expect(mockExecuteStream).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "/api/generate",
          body: expect.objectContaining({
            templateId: "new-template",
          }),
        }),
      );
    });

    it("reverts template on error", async () => {
      mockExecuteStream.mockRejectedValue(new Error("generation_failed"));

      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      await act(async () => {
        await result.current.handleRegenerate("new-template");
      });

      expect(opts.setError).toHaveBeenCalledWith("generation_failed");
      // Template should revert to default
      expect(result.current.selectedTemplateId).toBe("default-template");
    });
  });

  describe("handleLanguageChange", () => {
    it("patches encounter with new language", async () => {
      vi.mocked(patchEncounter).mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      await act(async () => {
        await result.current.handleLanguageChange("en");
      });

      expect(patchEncounter).toHaveBeenCalledWith("v1", { language: "en" });
      expect(result.current.generationLanguage).toBe("en");
    });
  });

  describe("handleTemplateChange", () => {
    it("patches encounter with new template id", () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      act(() => {
        result.current.handleTemplateChange("custom-template");
      });

      expect(patchEncounter).toHaveBeenCalledWith("v1", {
        metadata: { template_id: "custom-template" },
      });
      expect(result.current.selectedTemplateId).toBe("custom-template");
    });

    it("skips PATCH when visit is null", () => {
      const opts = defaultOptions();
      opts.visit = null as never;
      const { result } = renderHook(() => useEncounterGeneration(opts));

      act(() => {
        result.current.handleTemplateChange("custom-template");
      });

      expect(patchEncounter).not.toHaveBeenCalled();
    });
  });

  describe("initFromVisit", () => {
    it("sets language and template from visit metadata", () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      act(() => {
        result.current.initFromVisit(
          makeVisit({
            language: "en",
            metadata: { template_id: "custom" },
          }),
        );
      });

      expect(result.current.generationLanguage).toBe("en");
      expect(result.current.selectedTemplateId).toBe("custom");
    });

    it("restores from cache when status is processing", () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      act(() => {
        result.current.initFromVisit(makeVisit({ status: "processing" }));
      });

      expect(mockRestoreFromCache).toHaveBeenCalled();
    });

    it("sets generatedNoteHtml when encounter has a note", () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterGeneration(opts));

      act(() => {
        result.current.initFromVisit(
          makeVisit({
            encounter_note: "<p>Existing note</p>",
            metadata: {},
          }),
        );
      });

      expect(result.current.generatedNoteHtml).toBe("<p>Existing note</p>");
    });
  });
});
