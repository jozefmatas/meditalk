// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("@/lib/templates/html", () => ({
  buildTemplateHtml: vi.fn().mockReturnValue("<p>Built HTML</p>"),
}));

vi.mock("@/lib/parse-note-sections", () => ({
  parseNoteSections: vi.fn().mockReturnValue([]),
  allSectionsToPlainText: vi.fn().mockReturnValue("Plain text note"),
}));

const { buildTemplateHtml } = await import("@/lib/templates/html");
const mockBuildHtml = vi.mocked(buildTemplateHtml);

// Import after mocks
const { useNoteActions } = await import("./use-note-actions");

// ── Helpers ───────────────────────────────────────────────────────

import type { Template } from "@/lib/templates";

const fakeTemplate = {
  id: "t1",
  name: { sk: "Default" },
  description: { sk: "Test" },
  sections: [{ id: "s1", label: { sk: "Section 1" }, prompt: "" }],
} as unknown as Template;

function defaultParams() {
  return {
    template: fakeTemplate,
    sectionContents: { s1: "<p>Content</p>" },
    removedSections: new Set<string>(),
    sectionLabels: { s1: "Section 1" },
    generatedNoteHtml: "<p>Full note</p>",
    visitId: "v1",
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("useNoteActions", () => {
  let mockClipboardWrite: ReturnType<typeof vi.fn>;
  let mockClipboardWriteText: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockClipboardWrite = vi.fn().mockResolvedValue(undefined);
    mockClipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        write: mockClipboardWrite,
        writeText: mockClipboardWriteText,
      },
    });

    // JSDOM doesn't have ClipboardItem — stub it
    vi.stubGlobal(
      "ClipboardItem",
      class ClipboardItem {
        constructor(public items: Record<string, Blob>) {}
      },
    );

    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("initialises with idle state", () => {
    const { result } = renderHook(() => useNoteActions(defaultParams()));
    expect(result.current.noteCopied).toBe(false);
    expect(result.current.emailStatus).toBe("idle");
  });

  // ── Copy ──────────────────────────────────────────────────────

  it("handleCopyNote writes HTML and plaintext to clipboard", async () => {
    const { result } = renderHook(() => useNoteActions(defaultParams()));

    await act(() => result.current.handleCopyNote());

    expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
    expect(result.current.noteCopied).toBe(true);
  });

  it("handleCopyNote builds HTML from template when sectionContents exist", async () => {
    const { result } = renderHook(() => useNoteActions(defaultParams()));

    await act(() => result.current.handleCopyNote());

    expect(mockBuildHtml).toHaveBeenCalledWith(
      fakeTemplate,
      { s1: "<p>Content</p>" },
      { s1: "Section 1" },
      { skipEmpty: true },
    );
  });

  it("handleCopyNote excludes removed sections from built HTML", async () => {
    const params = {
      ...defaultParams(),
      sectionContents: { s1: "kept", s2: "removed" } as Record<string, string>,
      removedSections: new Set(["s2"]),
    };

    const { result } = renderHook(() => useNoteActions(params));
    await act(() => result.current.handleCopyNote());

    // buildTemplateHtml should receive only s1
    expect(mockBuildHtml).toHaveBeenCalledWith(
      fakeTemplate,
      { s1: "kept" },
      expect.any(Object),
      { skipEmpty: true },
    );
  });

  it("handleCopyNote falls back to writeText when clipboard.write fails", async () => {
    mockClipboardWrite.mockRejectedValueOnce(new Error("not supported"));

    const { result } = renderHook(() => useNoteActions(defaultParams()));
    await act(() => result.current.handleCopyNote());

    expect(mockClipboardWriteText).toHaveBeenCalledWith("Plain text note");
    expect(result.current.noteCopied).toBe(true);
  });

  it("handleCopyNote resets noteCopied after 2 seconds", async () => {
    const { result } = renderHook(() => useNoteActions(defaultParams()));

    await act(() => result.current.handleCopyNote());
    expect(result.current.noteCopied).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.noteCopied).toBe(false);
  });

  it("handleCopyNote falls back to generatedNoteHtml when no template", async () => {
    const params = { ...defaultParams(), template: undefined };

    const { result } = renderHook(() => useNoteActions(params));
    await act(() => result.current.handleCopyNote());

    expect(mockBuildHtml).not.toHaveBeenCalled();
    // Still writes to clipboard (using generatedNoteHtml)
    expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
  });

  // ── Email ─────────────────────────────────────────────────────

  it("handleSendEmail sends POST and sets status to sent", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useNoteActions(defaultParams()));
    await act(() => result.current.handleSendEmail());

    expect(fetchSpy).toHaveBeenCalledWith("/api/send-note-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitId: "v1" }),
    });
    expect(result.current.emailStatus).toBe("sent");
  });

  it("handleSendEmail sets status to failed on error", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false });

    const { result } = renderHook(() => useNoteActions(defaultParams()));
    await act(() => result.current.handleSendEmail());

    expect(result.current.emailStatus).toBe("failed");
  });

  it("handleSendEmail resets status to idle after 3 seconds", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useNoteActions(defaultParams()));
    await act(() => result.current.handleSendEmail());
    expect(result.current.emailStatus).toBe("sent");

    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.emailStatus).toBe("idle");
  });
});
