import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { logUsage, type UsageContext } from "./usage";

let _client: ElevenLabsClient | null = null;
function elevenlabs() {
  if (!_client) _client = new ElevenLabsClient();
  return _client;
}

/**
 * Batch-transcribe audio using ElevenLabs Scribe v2.
 *
 * @param file          Audio file (File or Buffer)
 * @param filename      Original filename (unused by Scribe, kept for signature compat)
 * @param languageCode  ISO 639-1 language code (e.g. 'sk', 'cs', 'en') for improved accuracy
 * @returns             Transcribed text
 */
export async function transcribeAudio(
  file: File | Buffer,
  filename: string,
  languageCode?: string,
  ctx?: UsageContext,
): Promise<string> {
  // Create a File with proper MIME type so ElevenLabs can detect the format
  const mimeMap: Record<string, string> = {
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
  };
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const audioFile =
    file instanceof File
      ? file
      : new File([new Uint8Array(file)], filename, {
          type: mimeMap[ext] || "audio/mpeg",
        });

  const result = await elevenlabs().speechToText.convert({
    file: audioFile,
    modelId: "scribe_v2",
    // Specify language for better accuracy (especially for non-English)
    languageCode: languageCode || undefined,
  });

  if (ctx) {
    const lastWord = result.words?.[result.words.length - 1];
    const durationSeconds =
      lastWord?.end ??
      (file instanceof File ? file.size : file.byteLength) / 16000;
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "elevenlabs",
      model: "scribe_v2",
      operation: "transcribe",
      durationSeconds,
    });
  }

  return result.text;
}

/**
 * Generate a single-use token for client-side Scribe v2 Realtime streaming.
 * Token expires after 15 minutes and can only be used once.
 */
export async function generateScribeToken(): Promise<string> {
  const response = await fetch(
    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to generate Scribe token: ${response.status}`);
  }

  const data = await response.json();
  return data.token;
}
