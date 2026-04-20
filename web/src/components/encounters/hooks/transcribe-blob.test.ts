// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transcribeBlob } from "./transcribe-blob";

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
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Run transcribeBlob while advancing fake timers so retries resolve. */
  async function runWithTimers(
    blob: Blob,
    lang: string,
    visitId: string,
    deps: { fetch: typeof fetch },
  ): Promise<string | null> {
    const promise = transcribeBlob(blob, lang, visitId, deps);
    // Advance past all retry delays (3s + 6s = 9s, add buffer)
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(3000);
    }
    return promise;
  }

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
    // webm blob → .webm filename
    const file = body.get("audio") as File;
    expect(file.name).toBe("recording.webm");
  });

  it("derives filename extension from blob MIME type (mp4 → .m4a)", async () => {
    const fetchStub = okFetch("mp4 transcript");
    // Safari records audio/mp4, not audio/webm
    const blob = new Blob([new Uint8Array(512)], { type: "audio/mp4" });

    const result = await transcribeBlob(blob, "sk", "visit-abc", {
      fetch: fetchStub,
    });

    expect(result).toBe("mp4 transcript");
    const body = (fetchStub as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1].body as FormData;
    const file = body.get("audio") as File;
    expect(file.name).toBe("recording.m4a");
  });

  it("returns null on a permanent non-OK response (no retry)", async () => {
    const fetchStub = errorFetch(400);
    const blob = makeBlob(1024);

    const result = await transcribeBlob(blob, "sk", "visit-abc", {
      fetch: fetchStub,
    });

    expect(result).toBeNull();
    // 400 is not transient — no retry
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("retries on transient HTTP errors (502) then returns null", async () => {
    const fetchStub = errorFetch(502);
    const blob = makeBlob(1024);

    const result = await runWithTimers(blob, "sk", "visit-abc", {
      fetch: fetchStub,
    });

    expect(result).toBeNull();
    // 502 is transient — retried twice (3 attempts total)
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it("retries on a transient HTTP error then succeeds", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ text: "recovered" }),
      }) as unknown as typeof fetch;
    const blob = makeBlob(1024);

    const result = await runWithTimers(blob, "sk", "visit-abc", {
      fetch: fetchStub,
    });

    expect(result).toBe("recovered");
    expect(fetchStub).toHaveBeenCalledTimes(2);
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

  it("retries on TypeError (network failure) then returns null", async () => {
    const fetchStub = throwingFetch();
    const blob = makeBlob(1024);

    const result = await runWithTimers(blob, "sk", "visit-abc", {
      fetch: fetchStub,
    });

    expect(result).toBeNull();
    // TypeError is transient — retried twice (3 attempts total)
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it("retries on TypeError then succeeds", async () => {
    const fetchStub = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ text: "after retry" }),
      }) as unknown as typeof fetch;
    const blob = makeBlob(1024);

    const result = await runWithTimers(blob, "sk", "visit-abc", {
      fetch: fetchStub,
    });

    expect(result).toBe("after retry");
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});
