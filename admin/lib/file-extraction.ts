import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

const OCR_PROMPT =
  "Extract ALL text content from this medical document. Preserve the structure and formatting (headers, subheaders, bullet points, numbered lists). Output only the extracted text, no commentary.";

/**
 * Auto-rotate an image based on EXIF orientation metadata using sharp.
 * Phone cameras typically store raw pixels in landscape + EXIF rotation tag.
 * sharp().rotate() without arguments reads the EXIF orientation and applies
 * the correct rotation (0°, 90°, 180°, 270°), then strips the tag.
 * No-op if the image is already correctly oriented.
 */
async function normalizeImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).rotate().toBuffer();
}

/**
 * Extract text from an uploaded file.
 * Supports: PDF (via URL or buffer), images (via URL with EXIF rotation or buffer), plain text.
 *
 * For images: Download → EXIF rotate with sharp → re-upload rotated → use signed URL (no 5MB limit)
 * For PDFs: Use signed URL directly (no size limit)
 */
export async function extractTextFromUpload(
  opts: { buffer?: Buffer; imageUrl?: string; pdfUrl?: string },
  mimeType: string,
): Promise<string | null> {
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    if (!opts.buffer) return null;
    return opts.buffer.toString("utf-8");
  }

  if (mimeType === "application/pdf") {
    // Prefer URL (no size limit)
    if (opts.pdfUrl) {
      return await ocrDocumentWithUrl(opts.pdfUrl);
    }
    // Fallback to base64 (5MB limit)
    if (opts.buffer) {
      return await ocrDocument(
        opts.buffer.toString("base64"),
        "application/pdf",
      );
    }
    return null;
  }

  if (mimeType.startsWith("image/")) {
    const mediaType = mimeType as
      | "image/jpeg"
      | "image/png"
      | "image/gif"
      | "image/webp";

    // Prefer URL (no size limit) with EXIF-rotated image
    if (opts.imageUrl) {
      return await ocrImageWithUrl(opts.imageUrl);
    }

    // Buffer fallback: EXIF rotate + base64 (5MB limit)
    if (opts.buffer) {
      const normalized = await normalizeImage(opts.buffer);
      const base64 = normalized.toString("base64");
      return await ocrImage(base64, mediaType);
    }

    return null;
  }

  return null;
}

async function ocrDocumentWithUrl(url: string): Promise<string | null> {
  console.log(`[pdf-extract] using URL source (no size limit)`);
  const response = await anthropic().messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "url", url },
          },
          { type: "text", text: OCR_PROMPT },
        ],
      },
    ],
  });
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return text?.trim() || null;
}

async function ocrDocument(
  base64Data: string,
  mediaType: string,
): Promise<string | null> {
  const response = await anthropic().messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: mediaType as "application/pdf",
              data: base64Data,
            },
          },
          { type: "text", text: OCR_PROMPT },
        ],
      },
    ],
  });
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return text?.trim() || null;
}

async function ocrImageWithUrl(url: string): Promise<string | null> {
  console.log(`[image-extract] using URL source (no size limit)`);
  const response = await anthropic().messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "url", url },
          },
          { type: "text", text: OCR_PROMPT },
        ],
      },
    ],
  });
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return text?.trim() || null;
}

async function ocrImage(
  base64Data: string,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<string | null> {
  const response = await anthropic().messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64Data },
          },
          { type: "text", text: OCR_PROMPT },
        ],
      },
    ],
  });
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return text?.trim() || null;
}
