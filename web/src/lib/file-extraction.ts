import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";
import sharp from "sharp";
import { transcribeAudio } from "./elevenlabs";
import type { SupportedLanguage } from "./types";
import { logUsage, type UsageContext } from "./usage";
import { logger } from "@/lib/logger";

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
 * Auto-rotate an image based on EXIF orientation metadata using sharp.
 * Phone cameras typically store raw pixels in landscape + EXIF rotation tag.
 * sharp().rotate() without arguments reads the EXIF orientation and applies
 * the correct rotation (0°, 90°, 180°, 270°), then strips the tag.
 * No-op if the image is already correctly oriented.
 */
export async function normalizeImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).rotate().toBuffer();
}

/**
 * Extract text content from a file based on its MIME type.
 *
 * - Image (PNG/JPEG): OCR via Claude Vision — downloaded, EXIF-rotated, sent as base64
 * - PDF: text extraction via Claude document API using a signed URL (no download needed)
 * - Audio: transcription via ElevenLabs Scribe v2 (requires buffer)
 *
 * For images, pass `imageBuffer` so we can normalize EXIF rotation before OCR.
 * For PDFs, pass a signed URL so Claude fetches the file directly.
 * For audio, pass `buffer` (ElevenLabs requires a File object).
 */
export async function extractTextFromFile(
  opts: {
    buffer?: Buffer;
    imageBuffer?: Buffer;
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
      // Preferred: download buffer → EXIF auto-rotate → base64
      if (opts.imageBuffer) {
        const normalized = await normalizeImage(opts.imageBuffer);
        const base64 = normalized.toString("base64");
        const mediaType = mimeType as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp";
        return await ocrImageWithBase64(base64, mediaType, language, ctx);
      }
      // Fallback: signed URL (no EXIF rotation — may fail for rotated photos)
      if (opts.imageUrl) {
        return await ocrImageWithUrl(opts.imageUrl, language, ctx);
      }
      if (opts.buffer) {
        const normalized = await normalizeImage(opts.buffer);
        const base64 = normalized.toString("base64");
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
      return await extractFromAudio(opts.buffer, filename, language, ctx);
    }

    return null;
  } catch (err) {
    logger.error(`Text extraction failed for ${filename}:`, err);
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
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string | null> {
  // Pass language to ElevenLabs for improved transcription accuracy
  const text = await transcribeAudio(buffer, filename, language, ctx);
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
  logger.debug(`[image-extract] using URL source (no size limit)`);

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
  logger.debug(`[pdf-extract] using URL source (no download needed)`);

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
