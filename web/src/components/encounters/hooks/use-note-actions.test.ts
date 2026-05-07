// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("@/lib/templates/html", () => ({
  buildTemplateHtml: vi.fn().mockReturnValue("<h2>Built</h2>"),
}));

vi.mock("@/lib/parse-note-sections", () => ({
  parseNoteSections: vi.fn().mockReturnValue([]),
  allSectionsToPlainText: vi.fn().mockReturnValue("plain text"),
}));

const { useNoteActions } = await import("./use-note-actions");
const { buildTemplateHtml } = await import("@/lib/templates/html");

// ── Helpers ────────────────────────────────────────────────────────

function defaultParams() {
  return {
    template: undefined as unknown,
    sectionContents: {} as Record<string, string>,
    removedSections: new Set<string>(),
    sectionLabels: {} as Record<string, string>,
    generatedNoteHtml: "<p>Generated</p>",
    visitId: "v1",
  } as Parameters<typeof useNoteActions>[0];
}

// ── Tests ──────────────────────────────────────────────────────────

// ClipboardItem doesn't exist in jsdom
vi.stubGlobal(
  "ClipboardItem",
  class ClipboardItem {
    constructor(public items: Record<string, Blob>) {}
  },
);

const mockClipboardWrite = vi.fn().mockResolvedValue(undefined);
const mockClipboardWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockClipboardWrite.mockResolvedValue(undefined);
  mockClipboardWriteText.mockResolvedValue(undefined);

  // Mock clipboard API — defineProperty needed since navigator.clipboard is non-configurable
  Object.defineProperty(navigator, "clipboard", {
    value: {
      write: mockClipboardWrite,
      writeText: mockClipboardWriteText,
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNoteActions", () => {
  describe("handleCopyNote", () => {
    it("writes HTML and plaintext to clipboard", async () => {
      const params = defaultParams();
      params.generatedNoteHtml = "<p>My note</p>";
      const { result } = renderHook(() => useNoteActions(params));

      await act(async () => {
        await result.current.handleCopyNote();
      });

      expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
    });

    it("falls back to writeText when rich clipboard fails", async () => {
      (mockClipboardWrite as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Not supported"),
      );
      const params = defaultParams();
      const { result } = renderHook(() => useNoteActions(params));

      await act(async () => {
        await result.current.handleCopyNote();
      });

      expect(mockClipboardWriteText).toHaveBeenCalledWith("plain text");
    });

    it("sets noteCopied for 2 seconds", async () => {
      const params = defaultParams();
      const { result } = renderHook(() => useNoteActions(params));

      expect(result.current.noteCopied).toBe(false);

      await act(async () => {
        await result.current.handleCopyNote();
      });

      expect(result.current.noteCopied).toBe(true);

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.noteCopied).toBe(false);
    });

    it("uses buildTemplateHtml when template and sections are available", async () => {
      const params = defaultParams();
      params.template = { id: "tmpl-1", sections: [] } as unknown as Parameters<
        typeof useNoteActions
      >[0]["template"];
      params.sectionContents = { s1: "Content", s2: "More" };
      params.removedSections = new Set(["s2"]);
      const { result } = renderHook(() => useNoteActions(params));

      await act(async () => {
        await result.current.handleCopyNote();
      });

      expect(buildTemplateHtml).toHaveBeenCalledWith(
        params.template,
        { s1: "Content" }, // s2 filtered out
        params.sectionLabels,
        { skipEmpty: true },
      );
    });
  });

  describe("handleSendEmail", () => {
    it("POSTs to /api/send-note-email with visitId", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
      const params = defaultParams();
      const { result } = renderHook(() => useNoteActions(params));

      await act(async () => {
        await result.current.handleSendEmail();
      });

      expect(fetch).toHaveBeenCalledWith("/api/send-note-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId: "v1" }),
      });
    });

    it("transitions emailStatus: idle → sending → sent → idle", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
      const params = defaultParams();
      const { result } = renderHook(() => useNoteActions(params));

      expect(result.current.emailStatus).toBe("idle");

      await act(async () => {
        await result.current.handleSendEmail();
      });

      expect(result.current.emailStatus).toBe("sent");

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.emailStatus).toBe("idle");
    });

    it("sets emailStatus to failed on error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
      const params = defaultParams();
      const { result } = renderHook(() => useNoteActions(params));

      await act(async () => {
        await result.current.handleSendEmail();
      });

      expect(result.current.emailStatus).toBe("failed");

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.emailStatus).toBe("idle");
    });
  });
});
