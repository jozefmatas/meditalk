// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipelineSession } from "./session";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("@/lib/sections/pipeline", () => ({
  generateNote: vi.fn(),
}));

vi.mock("@/lib/sections/suggest-icd", () => ({
  suggestIcdCodes: vi.fn(),
}));

vi.mock("@/lib/sections/file-focus", () => ({
  applyFileFocusDirectives: vi.fn(),
}));

vi.mock("@/lib/sections/note-skeleton", () => ({
  extractSkeleton: vi.fn(),
}));

vi.mock("@/lib/templates", () => ({
  buildSectionLabelsFromTemplate: vi.fn(),
}));

vi.mock("@/lib/templates/html", () => ({
  buildTemplateHtml: vi.fn(),
  flattenSectionIds: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { generateNote } from "@/lib/sections/pipeline";
import { suggestIcdCodes } from "@/lib/sections/suggest-icd";
import { applyFileFocusDirectives } from "@/lib/sections/file-focus";
import { extractSkeleton } from "@/lib/sections/note-skeleton";
import { buildSectionLabelsFromTemplate } from "@/lib/templates";
import { buildTemplateHtml, flattenSectionIds } from "@/lib/templates/html";

const mockGenerateNote = vi.mocked(generateNote);
const mockSuggestIcd = vi.mocked(suggestIcdCodes);
const mockFileFocus = vi.mocked(applyFileFocusDirectives);
const mockSkeleton = vi.mocked(extractSkeleton);
const mockBuildLabels = vi.mocked(buildSectionLabelsFromTemplate);
const mockBuildHtml = vi.mocked(buildTemplateHtml);
const mockFlattenIds = vi.mocked(flattenSectionIds);

const mockSupabase = {} as never;

const baseTemplate = {
  id: "tpl-1",
  name: { sk: "Test" },
  description: { sk: "Test" },
  sections: [
    { id: "oa", labels: { sk: "OA" } },
    { id: "to", labels: { sk: "TO" } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();

  // Default mock implementations
  mockFlattenIds.mockReturnValue(["oa", "to"]);
  mockBuildLabels.mockReturnValue({ oa: "OA", to: "TO" });
  mockFileFocus.mockImplementation(async (source) => source);
  mockSkeleton.mockResolvedValue(null);
  mockSuggestIcd.mockResolvedValue([]);
  mockBuildHtml.mockReturnValue("<h2>OA</h2><p>Test</p>");

  // generateNote: call onSection for each section
  mockGenerateNote.mockImplementation(async (input) => {
    input.onSection?.({
      id: "oa",
      title: "OA",
      content: "OA content",
    });
    input.onSection?.({
      id: "to",
      title: "TO",
      content: "TO content",
    });
    return undefined as never;
  });
});

// ── Tests ─────────────────────────────────────────────────────────

describe("runPipelineSession", () => {
  it("runs the full pipeline and returns generated note", async () => {
    const events: Record<string, unknown>[] = [];
    const sendEvent = (data: Record<string, unknown>) => events.push(data);

    const result = await runPipelineSession({
      supabase: mockSupabase,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      rawSource: { transcript: "Test transcript" },
      fileIds: [],
      visitMetadata: {},
      template: baseTemplate,
      sendEvent,
    });

    // Should emit streaming_start and section events
    expect(events[0]).toMatchObject({ type: "streaming_start" });
    expect(events.filter((e) => e.type === "section")).toHaveLength(2);

    // Result should have generated note
    expect(result.generatedNote).toBe("<h2>OA</h2><p>Test</p>");
    expect(result.sectionContents).toEqual({
      oa: "OA content",
      to: "TO content",
    });
    expect(result.templateId).toBe("tpl-1");
  });

  it("emits streaming_start with seed when priorSectionContents provided", async () => {
    const events: Record<string, unknown>[] = [];
    const priorContents = { oa: "Prior OA", to: "Prior TO" };

    await runPipelineSession({
      supabase: mockSupabase,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      rawSource: { transcript: "Test" },
      fileIds: [],
      visitMetadata: {},
      template: baseTemplate,
      sendEvent: (data) => events.push(data),
      priorSectionContents: priorContents,
    });

    expect(events[0]).toMatchObject({
      type: "streaming_start",
      seed: priorContents,
    });
  });

  it("passes icdSuggestionsPromise to generateNote", async () => {
    mockSuggestIcd.mockResolvedValue([
      { code: "I10", description: "Hypertenzia", confidence: "high" },
    ]);

    await runPipelineSession({
      supabase: mockSupabase,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      rawSource: { transcript: "Test" },
      fileIds: [],
      visitMetadata: {},
      template: baseTemplate,
      sendEvent: vi.fn(),
    });

    // generateNote should receive icdSuggestionsPromise
    expect(mockGenerateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        icdSuggestionsPromise: expect.any(Promise),
      }),
    );
  });

  it("includes clinicalAnalysis when ICD codes are suggested", async () => {
    mockSuggestIcd.mockResolvedValue([
      { code: "I10", description: "Hypertenzia", confidence: "high" },
    ]);

    const result = await runPipelineSession({
      supabase: mockSupabase,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      rawSource: { transcript: "Test" },
      fileIds: [],
      visitMetadata: {},
      template: baseTemplate,
      sendEvent: vi.fn(),
    });

    expect(result.clinicalAnalysis).toBeDefined();
    expect(result.clinicalAnalysis!.suggestedIcdCodes).toHaveLength(1);
  });

  it("returns no clinicalAnalysis when no ICD codes are suggested", async () => {
    mockSuggestIcd.mockResolvedValue([]);

    const result = await runPipelineSession({
      supabase: mockSupabase,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      rawSource: { transcript: "Test" },
      fileIds: [],
      visitMetadata: {},
      template: baseTemplate,
      sendEvent: vi.fn(),
    });

    expect(result.clinicalAnalysis).toBeUndefined();
  });

  it("passes leafIdFilter to generateNote", async () => {
    const filter = new Set(["oa"]);

    await runPipelineSession({
      supabase: mockSupabase,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      rawSource: { transcript: "Test" },
      fileIds: [],
      visitMetadata: {},
      template: baseTemplate,
      sendEvent: vi.fn(),
      leafIdFilter: filter,
    });

    expect(mockGenerateNote).toHaveBeenCalledWith(
      expect.objectContaining({ leafIdFilter: filter }),
    );
  });

  it("propagates file-focus cache updates", async () => {
    const newCache = {
      "file-1": { textHash: "abc", directive: "d", output: "o" },
    };
    mockFileFocus.mockImplementation(async (source, _lang, _usage, opts) => {
      opts?.onCacheUpdate?.(newCache);
      return source;
    });

    const result = await runPipelineSession({
      supabase: mockSupabase,
      userId: "user-1",
      visitId: "visit-1",
      language: "sk",
      rawSource: { transcript: "Test" },
      fileIds: ["file-1"],
      visitMetadata: {},
      template: baseTemplate,
      sendEvent: vi.fn(),
    });

    expect(result.updatedFileFocusCache).toEqual(newCache);
  });
});
