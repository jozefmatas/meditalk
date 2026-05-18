// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

const mockPatchEncounter = vi.fn();
vi.mock("@/lib/encounters/api", () => ({
  patchEncounter: (...args: unknown[]) => mockPatchEncounter(...args),
}));

vi.mock("@/lib/parse-note-sections", () => ({
  parseNoteToSectionMap: vi.fn().mockReturnValue({
    anamneza: "<p>Anamnéza</p>",
    obj_nalez: "<p>Nález</p>",
  }),
}));

vi.mock("@/lib/templates/html", () => ({
  buildTemplateHtml: vi.fn().mockReturnValue("<p>Built HTML</p>"),
}));

const { parseNoteToSectionMap } = await import("@/lib/parse-note-sections");
const { buildTemplateHtml } = await import("@/lib/templates/html");
const mockParseMap = vi.mocked(parseNoteToSectionMap);
const mockBuildHtml = vi.mocked(buildTemplateHtml);

const { useSectionEditing } = await import("./use-section-editing");

// ── Helpers ───────────────────────────────────────────────────────

import type { Template } from "@/lib/templates";

const fakeTemplate = {
  id: "t1",
  name: { sk: "Default" },
  description: { sk: "Test" },
  sections: [
    { id: "anamneza", label: { sk: "Anamnéza" }, prompt: "" },
    { id: "obj_nalez", label: { sk: "Obj. nález" }, prompt: "" },
  ],
} as unknown as Template;

function defaultOptions() {
  return {
    visitId: "v1",
    template: fakeTemplate,
    sectionLabels: { anamneza: "Anamnéza", obj_nalez: "Obj. nález" },
    generatedNoteHtml: "<p>Generated</p>",
    setGeneratedNoteHtml: vi.fn(),
    setVisit: vi.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("useSectionEditing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses generatedNoteHtml into sectionContents on mount", () => {
    const opts = defaultOptions();
    const { result } = renderHook(() => useSectionEditing(opts));

    expect(mockParseMap).toHaveBeenCalledWith("<p>Generated</p>", fakeTemplate);
    expect(result.current.sectionContents).toEqual({
      anamneza: "<p>Anamnéza</p>",
      obj_nalez: "<p>Nález</p>",
    });
  });

  it("auto-hides sections with empty content", () => {
    mockParseMap.mockReturnValueOnce({
      anamneza: "<p>Content</p>",
      obj_nalez: "", // empty
    });

    const opts = defaultOptions();
    const { result } = renderHook(() => useSectionEditing(opts));

    expect(result.current.removedSections.has("obj_nalez")).toBe(true);
    expect(result.current.removedSections.has("anamneza")).toBe(false);
  });

  it("handleSectionContentChange updates content and debounce-saves", async () => {
    mockPatchEncounter.mockResolvedValue({ ok: true });
    const opts = defaultOptions();
    const { result } = renderHook(() => useSectionEditing(opts));

    act(() => {
      result.current.handleSectionContentChange("anamneza", "<p>Edited</p>");
    });

    expect(result.current.sectionContents.anamneza).toBe("<p>Edited</p>");

    // Save is debounced — not called yet
    expect(mockPatchEncounter).not.toHaveBeenCalled();

    // Advance past debounce (2s)
    await act(() => vi.advanceTimersByTimeAsync(2500));

    expect(mockBuildHtml).toHaveBeenCalled();
    expect(mockPatchEncounter).toHaveBeenCalledWith("v1", {
      encounter_note: "<p>Built HTML</p>",
    });
  });

  it("handleRemoveSection adds section to removedSections", () => {
    const opts = defaultOptions();
    const { result } = renderHook(() => useSectionEditing(opts));

    act(() => result.current.handleRemoveSection("anamneza"));

    expect(result.current.removedSections.has("anamneza")).toBe(true);
  });

  it("handleAddSection removes section from removedSections", () => {
    const opts = defaultOptions();
    const { result } = renderHook(() => useSectionEditing(opts));

    // First remove, then re-add
    act(() => result.current.handleRemoveSection("anamneza"));
    expect(result.current.removedSections.has("anamneza")).toBe(true);

    act(() => result.current.handleAddSection("anamneza"));
    expect(result.current.removedSections.has("anamneza")).toBe(false);
  });

  it("handleAddSection sets focusSectionId for auto-scroll", () => {
    const opts = defaultOptions();
    const { result } = renderHook(() => useSectionEditing(opts));

    act(() => result.current.handleAddSection("anamneza"));
    expect(result.current.focusSectionId).toBe("anamneza");
  });

  it("handleAutoFocused clears focusSectionId", () => {
    const opts = defaultOptions();
    const { result } = renderHook(() => useSectionEditing(opts));

    act(() => result.current.handleAddSection("anamneza"));
    expect(result.current.focusSectionId).toBe("anamneza");

    act(() => result.current.handleAutoFocused());
    expect(result.current.focusSectionId).toBeNull();
  });

  it("replaceSections merges updates and persists immediately", () => {
    mockPatchEncounter.mockResolvedValue({ ok: true });
    const setGeneratedNoteHtml = vi.fn();
    const setVisit = vi.fn();
    const opts = defaultOptions();
    opts.setGeneratedNoteHtml = setGeneratedNoteHtml;
    opts.setVisit = setVisit;

    const { result } = renderHook(() => useSectionEditing(opts));

    act(() => {
      result.current.replaceSections({ anamneza: "<p>New content</p>" });
    });

    // Should update section contents
    expect(result.current.sectionContents.anamneza).toBe("<p>New content</p>");

    // Should persist immediately (no debounce)
    expect(mockPatchEncounter).toHaveBeenCalledWith("v1", {
      encounter_note: "<p>Built HTML</p>",
    });
    expect(setGeneratedNoteHtml).toHaveBeenCalledWith("<p>Built HTML</p>");
  });

  it("replaceSections un-hides previously removed sections with new content", () => {
    mockPatchEncounter.mockResolvedValue({ ok: true });
    mockParseMap.mockReturnValueOnce({ anamneza: "", obj_nalez: "<p>OK</p>" });

    const opts = defaultOptions();
    const { result } = renderHook(() => useSectionEditing(opts));

    // anamneza should be auto-hidden because it was empty
    expect(result.current.removedSections.has("anamneza")).toBe(true);

    // Now replace with content — should un-hide
    act(() => {
      result.current.replaceSections({ anamneza: "<p>New content</p>" });
    });

    expect(result.current.removedSections.has("anamneza")).toBe(false);
  });
});
