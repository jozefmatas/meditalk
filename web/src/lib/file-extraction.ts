import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { transcribeAudio } from "./elevenlabs";
import type { SupportedLanguage } from "./types";
import { logUsage, type UsageContext } from "./usage";

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ maxRetries: 4 });
  return _anthropic;
}

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "English",
  sk: "Slovak",
  cs: "Czech",
};

/**
 * Extract text content from a file based on its MIME type.
 *
 * - Image (PNG/JPEG): OCR via Claude Vision using a signed URL (no size limit)
 * - PDF: text extraction via Claude document API using a signed URL (no download needed)
 * - Audio: transcription via ElevenLabs Scribe v2 (requires buffer)
 *
 * For images and PDFs, pass a signed URL so Claude fetches the file
 * directly — this avoids inline base64 size limits entirely.
 * For audio, pass `buffer` (ElevenLabs requires a File object).
 */
export async function extractTextFromFile(
  opts: {
    buffer?: Buffer;
    imageUrl?: string;
    pdfUrl?: string;
  },
  filename: string,
  mimeType: string,
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string | null> {
  try {
    if (mimeType === "application/pdf") {
      if (opts.pdfUrl) {
        return await ocrPdfWithUrl(opts.pdfUrl, language, ctx);
      }
      if (opts.buffer) {
        return await extractFromPdf(opts.buffer, language, ctx);
      }
      return null;
    }

    if (mimeType.startsWith("image/")) {
      if (opts.imageUrl) {
        return await ocrImageWithUrl(opts.imageUrl, language, ctx);
      }
      // Fallback to base64 if no URL provided (shouldn't happen in normal flow)
      if (opts.buffer) {
        const base64 = opts.buffer.toString("base64");
        const mediaType = mimeType as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp";
        return await ocrImageWithBase64(base64, mediaType, language, ctx);
      }
      return null;
    }

    if (mimeType.startsWith("audio/")) {
      if (!opts.buffer) return null;
      return await extractFromAudio(opts.buffer, filename, ctx);
    }

    return null;
  } catch (err) {
    console.error(`Text extraction failed for ${filename}:`, err);
    return null;
  }
}

/**
 * Extract text from PDF using Claude document API.
 * Works for both text-based and scanned PDFs without native dependencies.
 */
async function extractFromPdf(
  buffer: Buffer,
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string | null> {
  const base64 = buffer.toString("base64");
  return await ocrPdfWithClaude(base64, language, ctx);
}

/**
 * Transcribe audio using ElevenLabs Scribe v2 (batch).
 */
async function extractFromAudio(
  buffer: Buffer,
  filename: string,
  ctx?: UsageContext,
): Promise<string | null> {
  const text = await transcribeAudio(buffer, filename, ctx);
  return text?.trim() || null;
}

function ocrPrompt(language: SupportedLanguage): string {
  const langLabel = LANGUAGE_LABELS[language];
  return `Extract ALL text content from this document/image. This is a medical document. Preserve the structure and formatting as much as possible. Output the extracted text in its original language. If the document is in ${langLabel}, keep it in ${langLabel}. Do not add any commentary or explanations — only output the extracted text.`;
}

/**
 * OCR for images using Claude Vision API with a URL source.
 * No inline size limit — Claude fetches the image directly.
 */
async function ocrImageWithUrl(
  url: string,
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string | null> {
  console.log(`[image-extract] using URL source (no size limit)`);

  const content: ContentBlockParam[] = [
    {
      type: "image",
      source: {
        type: "url",
        url,
      },
    },
    {
      type: "text",
      text: ocrPrompt(language),
    },
  ];

  const response = await anthropic().messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    messages: [{ role: "user", content }],
  });

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      operation: "ocr_image",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return text?.trim() || null;
}

/**
 * OCR for images using Claude Vision API with base64 (fallback).
 * Subject to Anthropic's 5 MB inline limit for base64 images.
 */
async function ocrImageWithBase64(
  base64Data: string,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string | null> {
  const content: ContentBlockParam[] = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: base64Data,
      },
    },
    {
      type: "text",
      text: ocrPrompt(language),
    },
  ];

  const response = await anthropic().messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    messages: [{ role: "user", content }],
  });

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      operation: "ocr_image",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return text?.trim() || null;
}

/**
 * Extract text from PDF using Claude document API with a URL source.
 * No download needed — Claude fetches the PDF directly.
 */
async function ocrPdfWithUrl(
  url: string,
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string | null> {
  console.log(`[pdf-extract] using URL source (no download needed)`);

  const content: ContentBlockParam[] = [
    {
      type: "document",
      source: {
        type: "url",
        url,
      },
    },
    {
      type: "text",
      text: ocrPrompt(language),
    },
  ];

  const response = await anthropic().messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    messages: [{ role: "user", content }],
  });

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      operation: "ocr_pdf",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return text?.trim() || null;
}

/**
 * OCR for scanned PDFs using Claude document API with base64 (fallback).
 */
async function ocrPdfWithClaude(
  base64Data: string,
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string | null> {
  const content: ContentBlockParam[] = [
    {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: base64Data,
      },
    },
    {
      type: "text",
      text: ocrPrompt(language),
    },
  ];

  const response = await anthropic().messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    messages: [{ role: "user", content }],
  });

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      operation: "ocr_pdf",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
  }

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return text?.trim() || null;
}
