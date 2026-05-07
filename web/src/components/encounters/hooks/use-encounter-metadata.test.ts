// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("@/lib/encounters/api", () => ({
  patchEncounter: vi.fn(),
}));

const { useEncounterMetadata } = await import("./use-encounter-metadata");
const { patchEncounter } = await import("@/lib/encounters/api");

// ── Helpers ────────────────────────────────────────────────────────

function makeVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    user_id: "u1",
    title: null as string | null,
    audio_path: null,
    language: "sk",
    visit_date: "2025-01-15",
    patient_name: null as string | null,
    patient_id: null,
    visit_type: "consultation" as const,
    status: "started" as const,
    encounter_note: null,
    metadata: {},
    created_at: "2025-01-15T00:00:00Z",
    ...overrides,
  };
}

function defaultOptions() {
  return {
    visitId: "v1",
    visit: makeVisit(),
    setVisit: vi.fn(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useEncounterMetadata", () => {
  describe("handleMetadataBlur", () => {
    it("skips PATCH when no fields changed", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterMetadata(opts));

      await act(async () => {
        await result.current.handleMetadataBlur();
      });

      expect(patchEncounter).not.toHaveBeenCalled();
    });

    it("skips PATCH when visit is null", async () => {
      const opts = defaultOptions();
      opts.visit = null as never;
      const { result } = renderHook(() => useEncounterMetadata(opts));

      await act(async () => {
        await result.current.handleMetadataBlur();
      });

      expect(patchEncounter).not.toHaveBeenCalled();
    });

    it("patches title when changed", async () => {
      (patchEncounter as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      });
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterMetadata(opts));

      act(() => {
        result.current.setTitle("New Title");
      });

      await act(async () => {
        await result.current.handleMetadataBlur();
      });

      expect(patchEncounter).toHaveBeenCalledWith("v1", {
        title: "New Title",
      });
      expect(opts.setVisit).toHaveBeenCalled();
    });

    it("trims title and converts empty to null", async () => {
      (patchEncounter as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      });
      const opts = defaultOptions();
      opts.visit = makeVisit({ title: "Old Title" });
      const { result } = renderHook(() => useEncounterMetadata(opts));

      act(() => {
        result.current.setTitle("  ");
      });

      await act(async () => {
        await result.current.handleMetadataBlur();
      });

      expect(patchEncounter).toHaveBeenCalledWith("v1", { title: null });
    });

    it("patches visit_type when changed", async () => {
      (patchEncounter as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      });
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterMetadata(opts));

      act(() => {
        result.current.setVisitType("follow_up");
      });

      await act(async () => {
        await result.current.handleMetadataBlur();
      });

      expect(patchEncounter).toHaveBeenCalledWith("v1", {
        visit_type: "follow_up",
      });
    });

    it("does not call setVisit when PATCH fails", async () => {
      (patchEncounter as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
      });
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterMetadata(opts));

      act(() => {
        result.current.setTitle("Changed");
      });

      await act(async () => {
        await result.current.handleMetadataBlur();
      });

      expect(patchEncounter).toHaveBeenCalled();
      expect(opts.setVisit).not.toHaveBeenCalled();
    });
  });

  describe("handlePatientBlur", () => {
    it("skips PATCH when visit is null", async () => {
      const opts = defaultOptions();
      opts.visit = null as never;
      const { result } = renderHook(() => useEncounterMetadata(opts));

      await act(async () => {
        await result.current.handlePatientBlur();
      });

      expect(patchEncounter).not.toHaveBeenCalled();
    });

    it("skips PATCH when no fields changed", async () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterMetadata(opts));

      await act(async () => {
        await result.current.handlePatientBlur();
      });

      expect(patchEncounter).not.toHaveBeenCalled();
    });

    it("patches patient_personal_id in metadata when changed", async () => {
      (patchEncounter as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      });
      const opts = defaultOptions();
      const { result } = renderHook(() => useEncounterMetadata(opts));

      act(() => {
        result.current.setPatientId("ABC123");
      });

      await act(async () => {
        await result.current.handlePatientBlur();
      });

      expect(patchEncounter).toHaveBeenCalledWith("v1", {
        metadata: { patient_personal_id: "ABC123" },
      });
    });

    it("merges metadata instead of replacing when updating setVisit", async () => {
      (patchEncounter as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      });
      const opts = defaultOptions();
      opts.visit = makeVisit({
        metadata: { template_id: "tmpl-1", files: [] },
      });
      const { result } = renderHook(() => useEncounterMetadata(opts));

      act(() => {
        result.current.setPatientId("NEW-ID");
      });

      await act(async () => {
        await result.current.handlePatientBlur();
      });

      // Verify that setVisit was called with an updater function
      expect(opts.setVisit).toHaveBeenCalled();
      const updater = (opts.setVisit as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      const result2 = updater(opts.visit);
      // Metadata should have been MERGED (template_id preserved, patient_personal_id added)
      expect(result2.metadata).toEqual({
        template_id: "tmpl-1",
        files: [],
        patient_personal_id: "NEW-ID",
      });
    });
  });
});
