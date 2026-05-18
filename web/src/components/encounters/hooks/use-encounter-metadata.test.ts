// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

const mockPatchEncounter = vi.fn();
vi.mock("@/lib/encounters/api", () => ({
  patchEncounter: (...args: unknown[]) => mockPatchEncounter(...args),
}));

// Import after mocks
const { useEncounterMetadata } = await import("./use-encounter-metadata");

// ── Helpers ───────────────────────────────────────────────────────

import type { Encounter } from "@/lib/types";

function makeVisit(overrides: Partial<Encounter> = {}): Encounter {
  return {
    id: "v1",
    user_id: "u1",
    title: "Existing title",
    audio_path: null,
    language: "sk",
    visit_date: "2025-01-01",
    patient_name: "Jan Novák",
    patient_id: null,
    visit_type: "consultation",
    status: "started",
    encounter_note: null,
    metadata: {},
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("useEncounterMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initialises with empty state", () => {
    const setVisit = vi.fn();
    const { result } = renderHook(() =>
      useEncounterMetadata({ visitId: "v1", visit: null, setVisit }),
    );

    expect(result.current.title).toBe("");
    expect(result.current.patientName).toBe("");
    expect(result.current.patientId).toBe("");
    expect(result.current.visitType).toBe("consultation");
  });

  it("handleMetadataBlur is a no-op when visit is null", async () => {
    const setVisit = vi.fn();
    const { result } = renderHook(() =>
      useEncounterMetadata({ visitId: "v1", visit: null, setVisit }),
    );

    await act(() => result.current.handleMetadataBlur());
    expect(mockPatchEncounter).not.toHaveBeenCalled();
  });

  it("handleMetadataBlur skips patch when nothing changed", async () => {
    const visit = makeVisit();
    const setVisit = vi.fn();
    const { result } = renderHook(() =>
      useEncounterMetadata({ visitId: "v1", visit, setVisit }),
    );

    // Set state to match existing visit values
    act(() => {
      result.current.setTitle("Existing title");
      result.current.setPatientName("Jan Novák");
      result.current.setVisitType("consultation");
    });

    await act(() => result.current.handleMetadataBlur());
    expect(mockPatchEncounter).not.toHaveBeenCalled();
  });

  it("handleMetadataBlur patches changed title and updates visit", async () => {
    const visit = makeVisit();
    const setVisit = vi.fn();
    mockPatchEncounter.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() =>
      useEncounterMetadata({ visitId: "v1", visit, setVisit }),
    );

    act(() => {
      result.current.setTitle("New title");
      result.current.setPatientName("Jan Novák"); // match existing
    });
    await act(() => result.current.handleMetadataBlur());

    expect(mockPatchEncounter).toHaveBeenCalledWith("v1", {
      title: "New title",
    });
    expect(setVisit).toHaveBeenCalled();
  });

  it("handleMetadataBlur does not call setVisit when patch fails", async () => {
    const visit = makeVisit();
    const setVisit = vi.fn();
    mockPatchEncounter.mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useEncounterMetadata({ visitId: "v1", visit, setVisit }),
    );

    act(() => result.current.setTitle("Different"));
    await act(() => result.current.handleMetadataBlur());

    expect(mockPatchEncounter).toHaveBeenCalled();
    expect(setVisit).not.toHaveBeenCalled();
  });

  it("handlePatientBlur patches patient_personal_id via metadata", async () => {
    const visit = makeVisit({ metadata: { patient_personal_id: "OLD-123" } });
    const setVisit = vi.fn();
    mockPatchEncounter.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() =>
      useEncounterMetadata({ visitId: "v1", visit, setVisit }),
    );

    act(() => {
      result.current.setPatientName("Jan Novák"); // unchanged
      result.current.setPatientId("NEW-456");
    });

    await act(() => result.current.handlePatientBlur());

    expect(mockPatchEncounter).toHaveBeenCalledWith("v1", {
      metadata: { patient_personal_id: "NEW-456" },
    });
    expect(setVisit).toHaveBeenCalled();
  });

  it("handlePatientBlur is a no-op when visit is null", async () => {
    const setVisit = vi.fn();
    const { result } = renderHook(() =>
      useEncounterMetadata({ visitId: "v1", visit: null, setVisit }),
    );

    await act(() => result.current.handlePatientBlur());
    expect(mockPatchEncounter).not.toHaveBeenCalled();
  });

  it("handlePatientBlur skips patch when nothing changed", async () => {
    const visit = makeVisit({ metadata: { patient_personal_id: "ABC" } });
    const setVisit = vi.fn();

    const { result } = renderHook(() =>
      useEncounterMetadata({ visitId: "v1", visit, setVisit }),
    );

    // Match existing values
    act(() => {
      result.current.setPatientName("Jan Novák");
      result.current.setPatientId("ABC");
    });

    await act(() => result.current.handlePatientBlur());
    expect(mockPatchEncounter).not.toHaveBeenCalled();
  });
});
