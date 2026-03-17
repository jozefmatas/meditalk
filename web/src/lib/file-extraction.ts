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
 * Extract text content from a file buffer based on its MIME type.
 *
 * - PDF: text extraction via Claude document API
 * - Image (PNG/JPEG): OCR via Claude Vision
 * - Audio: transcription via Whisper
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
 * Extract text from an image using Claude Vision API.
 */
async function extractFromImage(
  buffer: Buffer,
  mimeType: string,
  language: SupportedLanguage,
  ctx?: UsageContext,
): Promise<string | null> {
  const base64 = buffer.toString("base64");
  return await ocrImageWithClaude(
    base64,
    mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
    language,
    ctx,
  );
}

/**
 * Transcribe audio using Whisper.
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
