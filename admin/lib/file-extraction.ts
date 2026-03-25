import Anthropic from "@anthropic-ai/sdk";

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

const OCR_PROMPT =
  "Extract ALL text content from this medical document. Preserve the structure and formatting (headers, subheaders, bullet points, numbered lists). Output only the extracted text, no commentary.";

/**
 * Extract text from an uploaded file (base64-encoded).
 * Supports: PDF, images (PNG/JPEG/GIF/WEBP), plain text.
 */
export async function extractTextFromUpload(
  base64Data: string,
  mimeType: string,
): Promise<string | null> {
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return Buffer.from(base64Data, "base64").toString("utf-8");
  }

  if (mimeType === "application/pdf") {
    return await ocrDocument(base64Data, "application/pdf");
  }

  if (mimeType.startsWith("image/")) {
    return await ocrImage(
      base64Data,
      mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
    );
  }

  return null;
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
