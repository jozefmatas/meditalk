/**
 * Shared SSE (Server-Sent Events) utilities for streaming API routes.
 */

/**
 * Creates a ReadableStream wired up for SSE, returning helpers to send
 * events and close the stream safely. The `start` callback receives
 * `sendEvent` and `safeClose` — all stream logic goes inside it.
 */
export function createSSEStream(
  start: (helpers: {
    sendEvent: (data: Record<string, unknown>) => void;
    safeClose: () => void;
  }) => void | Promise<void>,
): ReadableStream {
  const encoder = new TextEncoder();
  let clientDisconnected = false;

  return new ReadableStream({
    start(controller) {
      function sendEvent(data: Record<string, unknown>) {
        if (clientDisconnected) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          clientDisconnected = true;
        }
      }

      function safeClose() {
        try {
          controller.close();
        } catch {
          /* already closed or cancelled */
        }
      }

      void start({ sendEvent, safeClose });
    },
    cancel() {
      clientDisconnected = true;
    },
  });
}

/** Wrap a ReadableStream in a Response with standard SSE headers. */
export function sseResponse(readable: ReadableStream): Response {
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Extract completed `"key": "value"` pairs from partially-accumulated JSON.
 * Calls `onSection` for each newly completed section, tracking already-emitted
 * IDs via the `emittedSections` set (mutated in place).
 */
export function extractSectionsFromStream(
  accumulated: string,
  sectionIds: Set<string>,
  emittedSections: Set<string>,
  sectionLabels: Record<string, string>,
  onSection: (id: string, title: string, content: string) => void,
): void {
  for (const id of sectionIds) {
    if (emittedSections.has(id)) continue;

    const keyPattern = `"${id}"\\s*:\\s*"`;
    const keyMatch = accumulated.match(new RegExp(keyPattern));
    if (!keyMatch) continue;

    const valueStart = keyMatch.index! + keyMatch[0].length;
    let pos = valueStart;
    let found = false;
    while (pos < accumulated.length) {
      if (accumulated[pos] === "\\") {
        pos += 2;
        continue;
      }
      if (accumulated[pos] === '"') {
        found = true;
        break;
      }
      pos++;
    }

    if (!found) continue;

    const rawValue = accumulated.slice(valueStart, pos);
    let value: string;
    try {
      value = JSON.parse(`"${rawValue}"`);
    } catch {
      value = rawValue;
    }

    emittedSections.add(id);
    onSection(id, sectionLabels[id] || id, value);
  }
}
