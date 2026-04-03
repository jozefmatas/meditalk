/**
 * Accumulates base64-encoded Int16 PCM chunks and builds a WAV file blob.
 *
 * Used on native platforms to construct a WAV file from streaming audio
 * chunks received from the NativeAudioStream Capacitor plugin.
 *
 * Audio format: 16 kHz, mono, 16-bit signed integer (little-endian).
 */

const SAMPLE_RATE = 16000;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;

export class WavBuilder {
  private chunks: Uint8Array[] = [];
  private totalBytes = 0;

  /** Append a base64-encoded Int16 PCM chunk. */
  addChunk(base64: string): void {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    this.chunks.push(bytes);
    this.totalBytes += bytes.length;
  }

  /** Total accumulated duration in milliseconds. */
  getDurationMs(): number {
    const totalSamples = this.totalBytes / BYTES_PER_SAMPLE;
    return (totalSamples / SAMPLE_RATE) * 1000;
  }

  /** Build a complete WAV blob from all accumulated chunks. */
  toBlob(): Blob {
    const dataSize = this.totalBytes;
    const header = buildWavHeader(dataSize);

    // Concatenate header + all PCM chunks
    const parts: BlobPart[] = [header];
    for (const chunk of this.chunks) {
      parts.push(chunk.buffer as ArrayBuffer);
    }

    return new Blob(parts, { type: "audio/wav" });
  }

  /** Clear all accumulated data. */
  reset(): void {
    this.chunks = [];
    this.totalBytes = 0;
  }

  /** Whether any audio data has been accumulated. */
  get hasData(): boolean {
    return this.totalBytes > 0;
  }
}

/**
 * Build a 44-byte WAV file header for PCM audio.
 *
 * Format: RIFF/WAVE, PCM (format code 1), 16 kHz, mono, 16-bit.
 */
function buildWavHeader(dataSize: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  const byteRate = SAMPLE_RATE * NUM_CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = NUM_CHANNELS * BYTES_PER_SAMPLE;

  // RIFF chunk descriptor
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true); // ChunkSize
  writeString(view, 8, "WAVE");

  // "fmt " sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (PCM = 16)
  view.setUint16(20, 1, true); // AudioFormat (PCM = 1)
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  // "data" sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true); // Subchunk2Size

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
