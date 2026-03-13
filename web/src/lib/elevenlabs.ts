import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { logUsage, type UsageContext } from './usage';

let _client: ElevenLabsClient | null = null;
function elevenlabs() {
  if (!_client) _client = new ElevenLabsClient();
  return _client;
}

/**
 * Batch-transcribe audio using ElevenLabs Scribe v2.
 *
 * @param file      Audio file (File or Buffer)
 * @param filename  Original filename (unused by Scribe, kept for signature compat)
 * @returns         Transcribed text
 */
export async function transcribeAudio(
  file: File | Buffer,
  filename: string,
  ctx?: UsageContext
): Promise<string> {
  const blob =
    file instanceof File
      ? new Blob([await file.arrayBuffer()])
      : new Blob([new Uint8Array(file)]);

  const result = await elevenlabs().speechToText.convert({
    file: blob,
    modelId: 'scribe_v2',
  });

  if (ctx) {
    const lastWord = result.words?.[result.words.length - 1];
    const durationSeconds = lastWord?.end ?? (file instanceof File ? file.size : file.byteLength) / 16000;
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: 'elevenlabs',
      model: 'scribe_v2',
      operation: 'transcribe',
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
    'https://api.elevenlabs.io/v1/speech-to-text/realtime/token',
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY!,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to generate Scribe token: ${response.status}`);
  }

  const data = await response.json();
  return data.token;
}
