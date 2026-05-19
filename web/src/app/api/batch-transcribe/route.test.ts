// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "@/test/route-helpers";

// ── Mocks ─────────────────────────────────────────────────────────

const mockSupabase = createMockSupabase();

vi.mock("@/lib/supabase/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    userId: "user-123",
    supabase: mockSupabase,
  }),
}));

const mockTranscribeAudio = vi.fn();
vi.mock("@/lib/elevenlabs", () => ({
  transcribeAudio: mockTranscribeAudio,
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { requireAuth } = await import("@/lib/supabase/auth");
const { POST } = await import("./route");

const mockRequireAuth = vi.mocked(requireAuth);

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockTranscribeAudio.mockResolvedValue("transcribed text");
});

describe("POST /api/batch-transcribe", () => {
  it("returns 401 when auth fails", async () => {
    // Production requireAuth() throws a Response with status 401.
    mockRequireAuth.mockRejectedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    const req = new NextRequest("http://localhost:3000/api/batch-transcribe", {
      method: "POST",
      body: JSON.stringify({ storagePath: "path/to/audio.m4a" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  describe("storage path mode", () => {
    it("returns 400 when storagePath is missing", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/batch-transcribe",
        {
          method: "POST",
          body: JSON.stringify({}),
          headers: { "Content-Type": "application/json" },
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("storagePath");
    });

    it("downloads from storage and transcribes", async () => {
      const audioBlob = new Blob(["audio data"], { type: "audio/m4a" });
      mockSupabase.storage
        .from("encounter-files")
        .download.mockResolvedValueOnce({
          data: audioBlob,
          error: null,
        });

      const req = new NextRequest(
        "http://localhost:3000/api/batch-transcribe",
        {
          method: "POST",
          body: JSON.stringify({
            storagePath: "user-123/v1/recording.m4a",
            language: "sk",
            visitId: "v1",
          }),
          headers: { "Content-Type": "application/json" },
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.text).toBe("transcribed text");
      expect(mockTranscribeAudio).toHaveBeenCalledWith(
        expect.any(File),
        "recording.m4a",
        "sk",
        { userId: "user-123", visitId: "v1" },
      );
    });

    it("returns 500 when storage download fails after retries", async () => {
      mockSupabase.storage.from("encounter-files").download.mockResolvedValue({
        data: null,
        error: { message: "not found" },
      });

      const req = new NextRequest(
        "http://localhost:3000/api/batch-transcribe",
        {
          method: "POST",
          body: JSON.stringify({ storagePath: "bad/path.m4a" }),
          headers: { "Content-Type": "application/json" },
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(500);
    }, 30000);
  });

  describe("direct blob mode", () => {
    it("returns 400 when audio file is missing", async () => {
      const formData = new FormData();
      const req = new NextRequest(
        "http://localhost:3000/api/batch-transcribe",
        {
          method: "POST",
          body: formData,
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("transcribes provided audio file", async () => {
      const formData = new FormData();
      const audioFile = new File(["audio content"], "recording.m4a", {
        type: "audio/m4a",
      });
      formData.set("audio", audioFile);
      formData.set("language", "en");
      formData.set("visitId", "v1");

      const req = new NextRequest(
        "http://localhost:3000/api/batch-transcribe",
        {
          method: "POST",
          body: formData,
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.text).toBe("transcribed text");
    });
  });

  it("returns 500 when transcription throws", async () => {
    mockTranscribeAudio.mockRejectedValueOnce(new Error("transcription error"));

    const formData = new FormData();
    formData.set(
      "audio",
      new File(["data"], "test.m4a", { type: "audio/m4a" }),
    );

    const req = new NextRequest("http://localhost:3000/api/batch-transcribe", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
