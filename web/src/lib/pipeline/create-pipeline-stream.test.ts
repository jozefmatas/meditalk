// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPipelineStream } from "./create-pipeline-stream";
import type { PipelineSessionResult } from "./session";

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock("./index", () => ({
  runPipelineSession: vi.fn(),
  persistGeneration: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { runPipelineSession } = await import("./index");
const { persistGeneration } = await import("./index");

const mockRunPipeline = vi.mocked(runPipelineSession);
const mockPersist = vi.mocked(persistGeneration);

// ── Helpers ───────────────────────────────────────────────────────

const dummySessionInput = {
  supabase: {} as never,
  userId: "u1",
  visitId: "v1",
  language: "sk" as const,
  rawSource: { transcript: "hello" },
  fileIds: [],
  visitMetadata: {},
  template: { id: "t1", sections: [] } as never,
};

const dummyPersist = {
  supabase: {} as never,
  visitId: "v1",
  metadataPartial: {},
  label: "test",
};

const dummyResult: PipelineSessionResult = {
  generatedNote: "<p>Note</p>",
  sectionContents: { la: "Ibuprofen 400mg" },
  templateId: "t1",
};

async function collectSSEEvents(response: Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.replace("data: ", "")));
}

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createPipelineStream", () => {
  it("returns an SSE Response with correct headers", () => {
    mockRunPipeline.mockResolvedValue(dummyResult);
    mockPersist.mockResolvedValue({ success: true });

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      label: "test",
    });

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("sends a complete event on successful pipeline + persist", async () => {
    mockRunPipeline.mockResolvedValue(dummyResult);
    mockPersist.mockResolvedValue({ success: true });

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      label: "test",
    });

    const events = await collectSSEEvents(response);
    const complete = events.find(
      (e) => (e as Record<string, unknown>).type === "complete",
    ) as Record<string, unknown>;

    expect(complete).toBeDefined();
    expect(complete.generatedNote).toBe("<p>Note</p>");
    expect(complete.templateId).toBe("t1");
  });

  it("sends an error event when persist fails", async () => {
    mockRunPipeline.mockResolvedValue(dummyResult);
    mockPersist.mockResolvedValue({ success: false, error: "db error" });

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      label: "test",
    });

    const events = await collectSSEEvents(response);
    const error = events.find(
      (e) => (e as Record<string, unknown>).type === "error",
    ) as Record<string, unknown>;

    expect(error).toBeDefined();
    expect(error.error).toBe("save_failed");
  });

  it("sends an error event when pipeline throws", async () => {
    mockRunPipeline.mockRejectedValue(new Error("pipeline boom"));
    mockPersist.mockResolvedValue({ success: true });

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      label: "test",
    });

    const events = await collectSSEEvents(response);
    const error = events.find(
      (e) => (e as Record<string, unknown>).type === "error",
    ) as Record<string, unknown>;

    expect(error).toBeDefined();
    expect(error.error).toBe("pipeline boom");
  });

  it("includes completeEventExtras in the complete event", async () => {
    const resultWithAnalysis: PipelineSessionResult = {
      ...dummyResult,
      clinicalAnalysis: { suggestedIcdCodes: [] },
    };
    mockRunPipeline.mockResolvedValue(resultWithAnalysis);
    mockPersist.mockResolvedValue({ success: true });

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      completeEventExtras: (result) => ({
        clinicalAnalysis: result.clinicalAnalysis,
      }),
      label: "test",
    });

    const events = await collectSSEEvents(response);
    const complete = events.find(
      (e) => (e as Record<string, unknown>).type === "complete",
    ) as Record<string, unknown>;

    expect(complete.clinicalAnalysis).toEqual({ suggestedIcdCodes: [] });
  });

  it("calls afterPersist on success", async () => {
    mockRunPipeline.mockResolvedValue(dummyResult);
    mockPersist.mockResolvedValue({ success: true });
    const afterPersist = vi.fn();

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      afterPersist,
      label: "test",
    });

    await collectSSEEvents(response);
    expect(afterPersist).toHaveBeenCalledWith(dummyResult);
  });

  it("does not call afterPersist when persist fails", async () => {
    mockRunPipeline.mockResolvedValue(dummyResult);
    mockPersist.mockResolvedValue({ success: false, error: "db error" });
    const afterPersist = vi.fn();

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      afterPersist,
      label: "test",
    });

    await collectSSEEvents(response);
    expect(afterPersist).not.toHaveBeenCalled();
  });

  it("still sends complete even if afterPersist throws", async () => {
    mockRunPipeline.mockResolvedValue(dummyResult);
    mockPersist.mockResolvedValue({ success: true });
    const afterPersist = vi.fn().mockRejectedValue(new Error("email failed"));

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      afterPersist,
      label: "test",
    });

    const events = await collectSSEEvents(response);
    const complete = events.find(
      (e) => (e as Record<string, unknown>).type === "complete",
    );
    expect(complete).toBeDefined();
  });

  it("passes sessionInput + sendEvent to runPipelineSession", async () => {
    mockRunPipeline.mockResolvedValue(dummyResult);
    mockPersist.mockResolvedValue({ success: true });

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      label: "test",
    });

    await collectSSEEvents(response);

    expect(mockRunPipeline).toHaveBeenCalledOnce();
    const call = mockRunPipeline.mock.calls[0][0];
    expect(call.userId).toBe("u1");
    expect(call.visitId).toBe("v1");
    expect(typeof call.sendEvent).toBe("function");
  });

  it("sends error event and skips pipeline when beforeSession throws", async () => {
    mockRunPipeline.mockResolvedValue(dummyResult);
    mockPersist.mockResolvedValue({ success: true });

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      beforeSession: async () => {
        throw new Error("transcription failed");
      },
      label: "test",
    });

    const events = await collectSSEEvents(response);
    const error = events.find(
      (e) => (e as Record<string, unknown>).type === "error",
    ) as Record<string, unknown>;

    expect(error).toBeDefined();
    expect(error.error).toBe("transcription failed");
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("runs beforeSession before pipeline and merges overrides", async () => {
    mockRunPipeline.mockResolvedValue(dummyResult);
    mockPersist.mockResolvedValue({ success: true });

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      beforeSession: async ({ sendEvent }) => {
        sendEvent({ type: "progress", stage: "transcribing" });
        return { rawSource: { transcript: "overridden transcript" } };
      },
      label: "test",
    });

    const events = await collectSSEEvents(response);

    // Progress event appears in the stream
    const progress = events.find(
      (e) => (e as Record<string, unknown>).type === "progress",
    ) as Record<string, unknown>;
    expect(progress).toBeDefined();
    expect(progress.stage).toBe("transcribing");

    // Pipeline receives the overridden rawSource
    const call = mockRunPipeline.mock.calls[0][0];
    expect(call.rawSource).toEqual({ transcript: "overridden transcript" });
    // Other fields from original sessionInput are preserved
    expect(call.userId).toBe("u1");
  });

  it("passes pipeline result fields to persistGeneration", async () => {
    mockRunPipeline.mockResolvedValue(dummyResult);
    mockPersist.mockResolvedValue({ success: true });

    const response = createPipelineStream({
      sessionInput: dummySessionInput,
      persist: dummyPersist,
      label: "test",
    });

    await collectSSEEvents(response);

    expect(mockPersist).toHaveBeenCalledOnce();
    const call = mockPersist.mock.calls[0][0];
    expect(call.generatedNote).toBe("<p>Note</p>");
    expect(call.templateId).toBe("t1");
    expect(call.sectionContents).toEqual({ la: "Ibuprofen 400mg" });
    expect(call.label).toBe("test");
  });
});
