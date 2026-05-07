// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("@/lib/parse-note-sections", () => ({
  parseNoteToSectionMap: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/templates/html", () => ({
  buildTemplateHtml: vi.fn().mockReturnValue("<h2>Built</h2>"),
}));

vi.mock("@/lib/encounters/api", () => ({
  patchEncounter: vi.fn(),
}));

const { useSectionEditing } = await import("./use-section-editing");
const { parseNoteToSectionMap } = await import("@/lib/parse-note-sections");
const { buildTemplateHtml } = await import("@/lib/templates/html");
const { patchEncounter } = await import("@/lib/encounters/api");

// ── Helpers ────────────────────────────────────────────────────────

function makeTemplate() {
  return {
    id: "tmpl-1",
    label: "Test Template",
    sections: [
      {
        id: "s1",
        label: "Section 1",
        subsections: [
          { id: "s1-a", label: "Sub A" },
          { id: "s1-b", label: "Sub B" },
        ],
      },
      {
        id: "s2",
        label: "Section 2",
        subsections: [],
      },
    ],
  } as unknown as Parameters<typeof useSectionEditing>[0]["template"];
}

function defaultOptions() {
  return {
    visitId: "v1",
    template: makeTemplate(),
    sectionLabels: { s1: "Section 1", s2: "Section 2" } as Record<
      string,
      string
    >,
    generatedNoteHtml: "<p>Note</p>",
    setGeneratedNoteHtml: vi.fn(),
    setVisit: vi.fn(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSectionEditing", () => {
  describe("initialization", () => {
    it("parses HTML into section contents on mount", () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s1: "Content 1",
        s2: "Content 2",
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useSectionEditing(opts));

      expect(parseNoteToSectionMap).toHaveBeenCalledWith(
        "<p>Note</p>",
        opts.template,
      );
      expect(result.current.sectionContents).toEqual({
        s1: "Content 1",
        s2: "Content 2",
      });
    });

    it("auto-hides entirely empty sections", () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s1: "",
        "s1-a": "",
        "s1-b": "",
        s2: "Has content",
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useSectionEditing(opts));

      // s1 and its subsections should be removed (all empty)
      expect(result.current.removedSections.has("s1")).toBe(true);
      expect(result.current.removedSections.has("s1-a")).toBe(true);
      expect(result.current.removedSections.has("s1-b")).toBe(true);
      // s2 has content, should not be removed
      expect(result.current.removedSections.has("s2")).toBe(false);
    });

    it("hides only empty subsections when parent has content", () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s1: "Parent has content",
        "s1-a": "",
        "s1-b": "Sub has content",
        s2: "",
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useSectionEditing(opts));

      // s1 has content — not removed
      expect(result.current.removedSections.has("s1")).toBe(false);
      // s1-a empty, s1-b not
      expect(result.current.removedSections.has("s1-a")).toBe(true);
      expect(result.current.removedSections.has("s1-b")).toBe(false);
    });
  });

  describe("handleSectionContentChange", () => {
    it("updates section content and triggers debounced save", async () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s1: "Original",
        s2: "Other",
      });
      (patchEncounter as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useSectionEditing(opts));

      act(() => {
        result.current.handleSectionContentChange("s1", "Updated content");
      });

      expect(result.current.sectionContents.s1).toBe("Updated content");

      // Save should not fire immediately (debounced at 2s)
      expect(patchEncounter).not.toHaveBeenCalled();

      // Advance timers to trigger debounced save
      await act(async () => {
        vi.advanceTimersByTime(2_000);
        await Promise.resolve();
      });

      expect(buildTemplateHtml).toHaveBeenCalled();
      expect(patchEncounter).toHaveBeenCalledWith("v1", {
        encounter_note: "<h2>Built</h2>",
      });
    });

    it("updates local HTML state after successful save", async () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s1: "Original",
      });
      (patchEncounter as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useSectionEditing(opts));

      act(() => {
        result.current.handleSectionContentChange("s1", "New");
      });

      await act(async () => {
        vi.advanceTimersByTime(2_000);
        await Promise.resolve();
      });

      expect(opts.setGeneratedNoteHtml).toHaveBeenCalledWith("<h2>Built</h2>");
      expect(opts.setVisit).toHaveBeenCalled();
    });
  });

  describe("handleRemoveSection", () => {
    it("adds section to removedSections and triggers save", async () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s1: "Content",
        s2: "More",
      });
      (patchEncounter as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useSectionEditing(opts));

      act(() => {
        result.current.handleRemoveSection("s1");
      });

      expect(result.current.removedSections.has("s1")).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(2_000);
        await Promise.resolve();
      });

      // buildTemplateHtml should have been called with s1 filtered out
      expect(buildTemplateHtml).toHaveBeenCalled();
      const filteredContents = (
        buildTemplateHtml as ReturnType<typeof vi.fn>
      ).mock.calls.at(-1)?.[1];
      expect(filteredContents).not.toHaveProperty("s1");
    });
  });

  describe("handleAddSection", () => {
    it("removes section from removedSections and triggers save", async () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s1: "",
        "s1-a": "",
        "s1-b": "",
        s2: "Content",
      });
      (patchEncounter as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useSectionEditing(opts));

      // s1 should be auto-removed (empty)
      expect(result.current.removedSections.has("s1")).toBe(true);

      act(() => {
        result.current.handleAddSection("s1");
      });

      expect(result.current.removedSections.has("s1")).toBe(false);
    });

    it("creates empty content entry for sections not yet in sectionContents", () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s2: "Content",
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useSectionEditing(opts));

      act(() => {
        result.current.handleAddSection("s1");
      });

      // Should have created an empty entry so the card renders
      expect(result.current.sectionContents).toHaveProperty("s1", "");
    });
  });

  describe("replaceSections", () => {
    it("merges partial updates into existing section contents", () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s1: "Original 1",
        s2: "Original 2",
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useSectionEditing(opts));

      act(() => {
        result.current.replaceSections({ s1: "Updated 1" });
      });

      expect(result.current.sectionContents.s1).toBe("Updated 1");
      expect(result.current.sectionContents.s2).toBe("Original 2");
    });

    it("unhides sections that receive non-empty content", () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s1: "",
        "s1-a": "",
        "s1-b": "",
        s2: "Content",
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useSectionEditing(opts));

      // s1 auto-removed
      expect(result.current.removedSections.has("s1")).toBe(true);

      act(() => {
        result.current.replaceSections({ s1: "Now has content" });
      });

      expect(result.current.removedSections.has("s1")).toBe(false);
    });

    it("persists immediately without debounce", () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s1: "Original",
      });

      const opts = defaultOptions();
      const { result } = renderHook(() => useSectionEditing(opts));

      act(() => {
        result.current.replaceSections({ s1: "Replaced" });
      });

      // Should call patchEncounter immediately (no debounce)
      expect(patchEncounter).toHaveBeenCalledWith("v1", {
        encounter_note: "<h2>Built</h2>",
      });
      expect(opts.setGeneratedNoteHtml).toHaveBeenCalledWith("<h2>Built</h2>");
    });

    it("skips re-parse of HTML when setting generatedNoteHtml", () => {
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockReturnValue({
        s1: "Original",
      });

      const opts = defaultOptions();
      const { result, rerender } = renderHook(() =>
        useSectionEditing(opts),
      );

      // Clear parseNoteToSectionMap calls from initial render
      (parseNoteToSectionMap as ReturnType<typeof vi.fn>).mockClear();

      act(() => {
        result.current.replaceSections({ s1: "New content" });
      });

      // Trigger re-render with updated HTML (simulating setGeneratedNoteHtml effect)
      opts.generatedNoteHtml = "<h2>Built</h2>";
      rerender();

      // parseNoteToSectionMap should NOT have been called again due to skipReparseRef
      expect(parseNoteToSectionMap).not.toHaveBeenCalled();
    });
  });
});
