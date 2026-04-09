// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTranscript, transcribeBlob } from "./transcribe-blob";

/** Build a fake Blob of the given byte size. */
function makeBlob(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: "audio/webm" });
}

/** Build a stub fetch that returns a JSON response with { text }. */
function okFetch(text: string): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ text }),
  }) as unknown as typeof fetch;
}

/** Build a stub fetch that returns a non-OK status. */
function errorFetch(status: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  }) as unknown as typeof fetch;
}

/** Build a stub fetch that throws (network failure). */
function throwingFetch(): typeof fetch {
  return vi
    .fn()
    .mockRejectedValue(
      new TypeError("Failed to fetch"),
    ) as unknown as typeof fetch;
}

describe("transcribeBlob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs the blob as multipart form-data with language + visitId", async () => {
    const fetchStub = okFetch("hello world");
    const blob = makeBlob(1024);

    const result = await transcribeBlob(blob, "sk", "visit-abc", {
      fetch: fetchStub,
    });

    expect(result).toBe("hello world");
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchStub as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("/api/batch-transcribe");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("language")).toBe("sk");
    expect(body.get("visitId")).toBe("visit-abc");
    expect(body.get("audio")).toBeInstanceOf(Blob);
  });

  it("returns null on a non-OK response", async () => {
    const fetchStub = errorFetch(500);
    const blob = makeBlob(1024);

    const result = await transcribeBlob(blob, "sk", "visit-abc", {
      fetch: fetchStub,
    });

    expect(result).toBeNull();
  });

  it("returns null when the response body has no text", async () => {
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const blob = makeBlob(1024);

    const result = await transcribeBlob(blob, "sk", "visit-abc", {
      fetch: fetchStub,
    });

    expect(result).toBeNull();
  });

  it("returns null when fetch throws (network failure)", async () => {
    const fetchStub = throwingFetch();
    const blob = makeBlob(1024);

    const result = await transcribeBlob(blob, "sk", "visit-abc", {
      fetch: fetchStub,
    });

    expect(result).toBeNull();
  });
});

describe("resolveTranscript — blob-first policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses batch result when blob is present and batch succeeds", async () => {
    // Core regression: user had a 5-minute recording with only 2 min of
    // streaming transcript (Scribe WebSocket died on Android screen lock).
    // The old code used the partial streaming transcript and lost 3 min
    // of audio. The new code must batch-transcribe the full blob and
    // use that instead.
    const fetchStub = okFetch("full 5-minute transcript from batch API");

    const result = await resolveTranscript(
      {
        blob: makeBlob(5_000_000),
        streamingCandidate: "partial 2-min transcript from streaming",
        language: "sk",
        visitId: "v1",
      },
      { fetch: fetchStub },
    );

    expect(result).toBe("full 5-minute transcript from batch API");
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("falls back to streaming candidate when batch transcription fails", async () => {
    // Network hiccup / 5xx — don't lose the partial transcript we do
    // have; it's better than nothing.
    const fetchStub = errorFetch(503);

    const result = await resolveTranscript(
      {
        blob: makeBlob(1_000_000),
        streamingCandidate: "partial streaming transcript",
        language: "sk",
        visitId: "v1",
      },
      { fetch: fetchStub },
    );

    expect(result).toBe("partial streaming transcript");
  });

  it("returns null when batch fails AND there is no streaming candidate", async () => {
    const fetchStub = errorFetch(500);

    const result = await resolveTranscript(
      {
        blob: makeBlob(1_000_000),
        streamingCandidate: null,
        language: "sk",
        visitId: "v1",
      },
      { fetch: fetchStub },
    );

    expect(result).toBeNull();
  });

  it("returns streaming candidate when no blob was recorded", async () => {
    // Legacy path: user typed only doctor notes / uploaded files, never
    // hit record. No blob exists. The streaming transcript is whatever
    // it happens to be (possibly null).
    const fetchStub = okFetch("should not be called");

    const result = await resolveTranscript(
      {
        blob: null,
        streamingCandidate: "text from Scribe real-time",
        language: "sk",
        visitId: "v1",
      },
      { fetch: fetchStub },
    );

    expect(result).toBe("text from Scribe real-time");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("returns null when there is neither a blob nor a streaming candidate", async () => {
    const fetchStub = okFetch("unused");

    const result = await resolveTranscript(
      {
        blob: null,
        streamingCandidate: null,
        language: "sk",
        visitId: "v1",
      },
      { fetch: fetchStub },
    );

    expect(result).toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("treats a zero-byte blob as if no blob existed", async () => {
    const fetchStub = okFetch("unused");

    const result = await resolveTranscript(
      {
        blob: makeBlob(0),
        streamingCandidate: "streaming text",
        language: "sk",
        visitId: "v1",
      },
      { fetch: fetchStub },
    );

    expect(result).toBe("streaming text");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("prefers batch even when streaming candidate looks 'complete'", async () => {
    // The heart of the fix: we NEVER trust the streaming transcript
    // when a blob exists, because "complete" is indistinguishable from
    // "truncated-but-plausible" at the client. Always round-trip
    // through batch when possible.
    const fetchStub = okFetch("canonical batch transcript");

    const result = await resolveTranscript(
      {
        blob: makeBlob(2_000_000),
        streamingCandidate:
          "a long and plausibly-complete looking streaming transcript",
        language: "sk",
        visitId: "v1",
      },
      { fetch: fetchStub },
    );

    expect(result).toBe("canonical batch transcript");
  });
});
