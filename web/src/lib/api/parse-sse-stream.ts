/**
 * Client-side SSE stream parser.
 *
 * Reads a ReadableStream of SSE data and dispatches typed callbacks for each
 * event. Used by the generation hooks to deduplicate the SSE parsing loop.
 */

export interface SSECallbacks {
  onStreamingStart?: (event: {
    sectionIds: string[];
    sectionLabels: Record<string, string>;
  }) => void;
  onSection?: (event: { id: string; title: string; content: string }) => void;
  onComplete?: (event: Record<string, unknown>) => void;
  onError?: (error: string) => void;
  /** Progress events during source resolution (transcription, extraction). */
  onProgress?: (event: { stage: string; message?: string }) => void;
}

export async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  callbacks: SSECallbacks,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6);
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr);

        if (event.type === "streaming_start") {
          callbacks.onStreamingStart?.(event);
        } else if (event.type === "progress") {
          callbacks.onProgress?.(event);
        } else if (event.type === "section") {
          callbacks.onSection?.(event);
        } else if (event.type === "complete") {
          callbacks.onComplete?.(event);
        } else if (event.type === "error") {
          callbacks.onError?.(event.error);
        }
      } catch (parseErr) {
        if (
          parseErr instanceof Error &&
          parseErr.message !== "Unexpected end of JSON input"
        ) {
          throw parseErr;
        }
      }
    }
  }
}
