// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
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
