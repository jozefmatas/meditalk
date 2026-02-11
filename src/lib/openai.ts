import OpenAI from 'openai';

const openai = new OpenAI();

/**
 * Transcribe audio using Whisper.
 *
 * @param file      Audio file (File or Buffer)
 * @param filename  Original filename (used for content-type detection)
 * @returns         Transcribed text
 */
export async function transcribeAudio(
  file: File | Buffer,
  filename: string
): Promise<string> {
  const uploadable =
    file instanceof File
      ? file
      : new File([new Uint8Array(file)], filename, { type: 'audio/webm' });

  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: uploadable,
    response_format: 'text',
  });

  return response as unknown as string;
}

/**
 * Generate a 1536-dim embedding for a single text.
 */
export async function embedText(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single API call.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: texts,
  });

  return response.data.map((d) => d.embedding);
}
