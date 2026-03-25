import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";
import sharp from "sharp";
import { transcribeAudio } from "./elevenlabs";
import type { SupportedLanguage } from "./types";
import { logUsage, type UsageContext } from "./usage";

/** Anthropic's max image size is 5 MB (5,242,880 bytes). */
const MAX_IMAGE_BYTES = 5_242_880;

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
 * Extract text content from a file buffer based on its MIME type.
 *
 * - PDF: text extraction via Claude document API
 * - Image (PNG/JPEG): OCR via Claude Vision
 * - Audio: transcription via ElevenLabs Scribe v2
 *
 * Returns extracted text or null on failure.
 */
export async function extractTextFromFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string | null> {
  try {
    if (mimeType === "application/pdf") {
      return await extractFromPdf(buffer, language, ctx);
    }

    if (mimeType.startsWith("image/")) {
      return await extractFromImage(buffer, mimeType, language, ctx);
    }

    if (mimeType.startsWith("audio/")) {
      return await extractFromAudio(buffer, filename, ctx);
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
 * Compress an image buffer to fit within Anthropic's 5 MB limit.
 * Converts to JPEG and progressively reduces quality/dimensions until under limit.
 */
export async function compressImage(
  buffer: Buffer,
): Promise<{ data: Buffer; mediaType: "image/jpeg" }> {
  let quality = 85;
  let resizeWidth: number | undefined;

  // Get original dimensions
  const metadata = await sharp(buffer).metadata();
  const originalWidth = metadata.width ?? 4096;

  // Start with original dimensions, reduce if needed
  let result = await sharp(buffer).jpeg({ quality }).toBuffer();

  while (result.byteLength > MAX_IMAGE_BYTES && quality > 20) {
    quality -= 15;
    if (quality <= 50 && !resizeWidth) {
      // Also reduce dimensions if quality alone isn't enough
      resizeWidth = Math.min(originalWidth, 2048);
    } else if (resizeWidth) {
      resizeWidth = Math.floor(resizeWidth * 0.75);
    }

    let pipeline = sharp(buffer);
    if (resizeWidth) {
      pipeline = pipeline.resize(resizeWidth, undefined, { fit: "inside" });
    }
    result = await pipeline.jpeg({ quality }).toBuffer();
  }

  console.log(
    `[image-compress] ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB → ${(result.byteLength / 1024 / 1024).toFixed(1)}MB (quality=${quality}${resizeWidth ? `, width=${resizeWidth}` : ""})`,
  );

  return { data: result, mediaType: "image/jpeg" };
}

/**
 * Extract text from an image using Claude Vision API.
 */
async function extractFromImage(
  buffer: Buffer,
  mimeType: string,
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string | null> {
  let imageBuffer = buffer;
  let mediaType = mimeType as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";

  // Compress if over Anthropic's 5 MB limit for inline base64 images
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    console.log(
      `[image-extract] image ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB exceeds 5MB limit, compressing...`,
    );
    try {
      const compressed = await compressImage(buffer);
      imageBuffer = compressed.data;
      mediaType = compressed.mediaType;
    } catch (compressErr) {
      console.error("[image-extract] compression failed:", compressErr);
      // Still attempt to send — Claude may accept it or give a clear error
    }
  }

  const base64 = imageBuffer.toString("base64");
  return await ocrImageWithClaude(base64, mediaType, language, ctx);
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
 * OCR for images using Claude Vision API (type: 'image').
 */
async function ocrImageWithClaude(
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
 * OCR for scanned PDFs using Claude document API (type: 'document').
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
