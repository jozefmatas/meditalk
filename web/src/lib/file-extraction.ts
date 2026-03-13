import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';
import { PDFParse } from 'pdf-parse';
import { transcribeAudio } from './openai';
import type { SupportedLanguage } from './types';

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  sk: 'Slovak',
  cs: 'Czech',
};

/**
 * Extract text content from a file buffer based on its MIME type.
 *
 * - PDF: text extraction via pdf-parse, fallback to Claude document API for scanned PDFs
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
): Promise<string | null> {
  try {
    if (mimeType === 'application/pdf') {
      return await extractFromPdf(buffer, language);
    }

    if (mimeType.startsWith('image/')) {
      return await extractFromImage(buffer, mimeType, language);
    }

    if (mimeType.startsWith('audio/')) {
      return await extractFromAudio(buffer, filename);
    }

    return null;
  } catch (err) {
    console.error(`Text extraction failed for ${filename}:`, err);
    return null;
  }
}

/**
 * Extract text from PDF. Uses pdf-parse for text-based PDFs.
 * Falls back to Claude document API if pdf-parse returns negligible text.
 */
async function extractFromPdf(
  buffer: Buffer,
  language: SupportedLanguage,
): Promise<string | null> {
  const pdf = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await pdf.getText();
  const text = result.text?.trim();

  // If pdf-parse extracted meaningful text, use it
  if (text && text.length > 50) {
    return text;
  }

  // Scanned PDF — fall back to Claude document API
  const base64 = buffer.toString('base64');
  return await ocrPdfWithClaude(base64, language);
}

/**
 * Extract text from an image using Claude Vision API.
 */
async function extractFromImage(
  buffer: Buffer,
  mimeType: string,
  language: SupportedLanguage,
): Promise<string | null> {
  const base64 = buffer.toString('base64');
  return await ocrImageWithClaude(
    base64,
    mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
    language,
  );
}

/**
 * Transcribe audio using Whisper.
 */
async function extractFromAudio(
  buffer: Buffer,
  filename: string,
): Promise<string | null> {
  const text = await transcribeAudio(buffer, filename);
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
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
  language: SupportedLanguage,
): Promise<string | null> {
  const content: ContentBlockParam[] = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64Data,
      },
    },
    {
      type: 'text',
      text: ocrPrompt(language),
    },
  ];

  const response = await anthropic().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  });

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '';
  return text?.trim() || null;
}

/**
 * OCR for scanned PDFs using Claude document API (type: 'document').
 */
async function ocrPdfWithClaude(
  base64Data: string,
  language: SupportedLanguage,
): Promise<string | null> {
  const content: ContentBlockParam[] = [
    {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: base64Data,
      },
    },
    {
      type: 'text',
      text: ocrPrompt(language),
    },
  ];

  const response = await anthropic().messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  });

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '';
  return text?.trim() || null;
}
