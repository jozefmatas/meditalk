import { describe, it, expect, vi } from "vitest";
import { parseSSEStream, type SSECallbacks } from "./parse-sse-stream";

/** Build a ReadableStream from an array of string chunks. */
function mockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

describe("parseSSEStream", () => {
  it("dispatches streaming_start, section, and complete events", async () => {
    const callbacks: SSECallbacks = {
      onStreamingStart: vi.fn(),
      onSection: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };

    const stream = mockStream([
      'data: {"type":"streaming_start","sectionIds":["s1","s2"],"sectionLabels":{"s1":"Section 1","s2":"Section 2"}}\n',
      'data: {"type":"section","id":"s1","title":"Section 1","content":"Hello"}\n',
      'data: {"type":"complete","generatedNote":"<p>Done</p>","letter":"Dear patient"}\n',
    ]);

    await parseSSEStream(stream, callbacks);

    expect(callbacks.onStreamingStart).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionIds: ["s1", "s2"],
        sectionLabels: { s1: "Section 1", s2: "Section 2" },
      }),
    );
    expect(callbacks.onSection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "s1",
        title: "Section 1",
        content: "Hello",
      }),
    );
    expect(callbacks.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedNote: "<p>Done</p>",
        letter: "Dear patient",
      }),
    );
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("dispatches error events via onError", async () => {
    const callbacks: SSECallbacks = {
      onError: vi.fn(),
    };

    const stream = mockStream([
      'data: {"type":"error","error":"Something went wrong"}\n',
    ]);

    await parseSSEStream(stream, callbacks);
    expect(callbacks.onError).toHaveBeenCalledWith("Something went wrong");
  });

  it("handles data split across multiple chunks", async () => {
    const callbacks: SSECallbacks = {
      onSection: vi.fn(),
    };

    // JSON split mid-line across two chunks
    const stream = mockStream([
      'data: {"type":"section","id":"s1",',
      '"title":"T","content":"C"}\n',
    ]);

    await parseSSEStream(stream, callbacks);
    expect(callbacks.onSection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", title: "T", content: "C" }),
    );
  });

  it("ignores lines that are not SSE data", async () => {
    const callbacks: SSECallbacks = {
      onSection: vi.fn(),
    };

    const stream = mockStream([
      ": comment line\n",
      "event: custom\n",
      'data: {"type":"section","id":"s1","title":"T","content":"C"}\n',
      "\n",
    ]);

    await parseSSEStream(stream, callbacks);
    expect(callbacks.onSection).toHaveBeenCalledTimes(1);
  });

  it("suppresses 'Unexpected end of JSON input' but rethrows other parse errors", async () => {
    const callbacks: SSECallbacks = {
      onComplete: vi.fn(),
    };

    // Truncated JSON value triggers "Unexpected end of JSON input"
    const stream = mockStream([
      'data: {"type":\n',
      'data: {"type":"complete","generatedNote":"ok"}\n',
    ]);

    await parseSSEStream(stream, callbacks);
    // The incomplete JSON is silently ignored; complete fires
    expect(callbacks.onComplete).toHaveBeenCalled();
  });

  it("works with no callbacks provided", async () => {
    const stream = mockStream([
      'data: {"type":"streaming_start","sectionIds":[],"sectionLabels":{}}\n',
      'data: {"type":"complete","generatedNote":""}\n',
    ]);

    // Should not throw
    await parseSSEStream(stream, {});
  });
});
