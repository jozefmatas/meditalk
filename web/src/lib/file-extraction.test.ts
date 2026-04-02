import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env modules
vi.mock("@/lib/env/server", () => ({
  serverEnv: { NODE_ENV: "test" },
}));

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-key",
    NEXT_PUBLIC_APP_URL: "",
  },
}));

// Mock Anthropic SDK
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

// Mock sharp
vi.mock("sharp", () => ({
  default: vi.fn().mockImplementation(() => ({
    rotate: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("rotated-image")),
  })),
}));

// Mock ElevenLabs transcription
const mockTranscribe = vi.fn();
vi.mock("./elevenlabs", () => ({
  transcribeAudio: (...args: unknown[]) => mockTranscribe(...args),
}));

// Mock usage logging
vi.mock("./usage", () => ({
  logUsage: vi.fn(),
}));

import { extractTextFromFile, normalizeImage } from "./file-extraction";

// ── Tests ──

describe("normalizeImage", () => {
  it("returns a buffer", async () => {
    const result = await normalizeImage(Buffer.from("test-image"));
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});

describe("extractTextFromFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── PDF routing ───

  it("routes PDF with URL to Claude document API", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Extracted PDF text" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await extractTextFromFile(
      { pdfUrl: "https://example.com/file.pdf" },
      "report.pdf",
      "application/pdf",
      "en",
    );

    expect(result).toBe("Extracted PDF text");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content[0].type).toBe("document");
    expect(call.messages[0].content[0].source.type).toBe("url");
  });

  it("routes PDF with buffer to base64 document API", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "PDF from buffer" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await extractTextFromFile(
      { buffer: Buffer.from("fake-pdf-content") },
      "report.pdf",
      "application/pdf",
      "en",
    );

    expect(result).toBe("PDF from buffer");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content[0].type).toBe("document");
    expect(call.messages[0].content[0].source.type).toBe("base64");
  });

  it("returns null for PDF with no opts", async () => {
    const result = await extractTextFromFile(
      {},
      "report.pdf",
      "application/pdf",
      "en",
    );
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ─── Image routing ───

  it("routes image with imageBuffer through EXIF rotation + base64", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "OCR from image" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await extractTextFromFile(
      { imageBuffer: Buffer.from("raw-photo") },
      "photo.jpg",
      "image/jpeg",
      "sk",
    );

    expect(result).toBe("OCR from image");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content[0].type).toBe("image");
    expect(call.messages[0].content[0].source.type).toBe("base64");
  });

  it("routes image with imageUrl to URL-based vision API", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "OCR from URL" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await extractTextFromFile(
      { imageUrl: "https://example.com/photo.jpg" },
      "photo.jpg",
      "image/jpeg",
      "en",
    );

    expect(result).toBe("OCR from URL");
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content[0].source.type).toBe("url");
  });

  it("routes image with only buffer through rotation + base64", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "OCR from buffer" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await extractTextFromFile(
      { buffer: Buffer.from("raw-image") },
      "scan.png",
      "image/png",
      "cs",
    );

    expect(result).toBe("OCR from buffer");
  });

  it("returns null for image with no opts", async () => {
    const result = await extractTextFromFile(
      {},
      "photo.jpg",
      "image/jpeg",
      "en",
    );
    expect(result).toBeNull();
  });

  // ─── Audio routing ───

  it("routes audio to ElevenLabs transcription", async () => {
    mockTranscribe.mockResolvedValue("Transcribed audio text");

    const result = await extractTextFromFile(
      { buffer: Buffer.from("audio-data") },
      "recording.ogg",
      "audio/ogg",
      "sk",
    );

    expect(result).toBe("Transcribed audio text");
    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      "recording.ogg",
      "sk",
      undefined,
    );
  });

  it("returns null for audio without buffer", async () => {
    const result = await extractTextFromFile(
      {},
      "recording.ogg",
      "audio/ogg",
      "en",
    );
    expect(result).toBeNull();
  });

  it("returns null for empty transcription", async () => {
    mockTranscribe.mockResolvedValue("  ");

    const result = await extractTextFromFile(
      { buffer: Buffer.from("audio-data") },
      "recording.ogg",
      "audio/ogg",
      "en",
    );

    expect(result).toBeNull();
  });

  // ─── Unsupported types ───

  it("returns null for unsupported MIME types", async () => {
    const result = await extractTextFromFile(
      { buffer: Buffer.from("data") },
      "file.csv",
      "text/csv",
      "en",
    );
    expect(result).toBeNull();
  });

  // ─── Error handling ───

  it("returns null and logs error on extraction failure", async () => {
    mockCreate.mockRejectedValue(new Error("API error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await extractTextFromFile(
      { pdfUrl: "https://example.com/fail.pdf" },
      "fail.pdf",
      "application/pdf",
      "en",
    );

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  // ─── Usage context ───

  it("logs usage when context is provided", async () => {
    const { logUsage } = await import("./usage");

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "result" }],
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    await extractTextFromFile(
      { pdfUrl: "https://example.com/doc.pdf" },
      "doc.pdf",
      "application/pdf",
      "en",
      { userId: "user-123", visitId: "visit-456" },
    );

    expect(logUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        visitId: "visit-456",
        provider: "anthropic",
        operation: "ocr_pdf",
      }),
    );
  });

  // ─── Priority order ───

  it("prefers imageBuffer over imageUrl for images", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "base64 path" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await extractTextFromFile(
      {
        imageBuffer: Buffer.from("raw"),
        imageUrl: "https://example.com/img.jpg",
      },
      "img.jpg",
      "image/jpeg",
      "en",
    );

    // Should use base64 (imageBuffer path), not URL
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content[0].source.type).toBe("base64");
  });

  it("prefers pdfUrl over buffer for PDFs", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "url path" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await extractTextFromFile(
      {
        pdfUrl: "https://example.com/doc.pdf",
        buffer: Buffer.from("pdf-bytes"),
      },
      "doc.pdf",
      "application/pdf",
      "en",
    );

    // Should use URL path
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content[0].source.type).toBe("url");
  });
});
