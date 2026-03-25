/**
 * Convert an audio Blob (WebM/Opus, OGG, MP4/AAC, or any browser-decodable format)
 * to a mono 16 kHz WAV Blob using the Web Audio API.
 *
 * Uses OfflineAudioContext for decoding — unlike AudioContext it doesn't require
 * a user gesture, so it works reliably on iOS even in async callbacks.
 */
export async function convertToWav(audioBlob: Blob): Promise<Blob> {
  const arrayBuffer = await audioBlob.arrayBuffer();

  if (arrayBuffer.byteLength < 100) {
    throw new Error("Audio blob too small to be valid");
  }

  // OfflineAudioContext.decodeAudioData works without a user gesture (critical
  // for iOS Safari where AudioContext creation outside a tap handler fails).
  // Params (channels, length, sampleRate) are only used for rendering — decoding
  // ignores them and returns the file's actual format.
  const offlineCtx = new OfflineAudioContext(1, 1, 44100);
  const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

  // Take first channel (mono)
  const inputData = audioBuffer.getChannelData(0);
  const inputRate = audioBuffer.sampleRate;

  // Downsample to 16 kHz (sufficient for speech, keeps files small)
  const targetRate = 16000;
  const ratio = inputRate / targetRate;
  const outputLength = Math.floor(inputData.length / ratio);
  const int16 = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const s = Math.max(-1, Math.min(1, inputData[Math.floor(i * ratio)]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const wavBuffer = encodeWav(int16, targetRate);
  return new Blob([wavBuffer], { type: "audio/wav" });
}

function encodeWav(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const numChannels = 1;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const v = new DataView(buffer);

  // RIFF header
  writeStr(v, 0, "RIFF");
  v.setUint32(4, 36 + dataLength, true);
  writeStr(v, 8, "WAVE");

  // fmt chunk
  writeStr(v, 12, "fmt ");
  v.setUint32(16, 16, true); // chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  v.setUint16(32, numChannels * bytesPerSample, true);
  v.setUint16(34, bytesPerSample * 8, true);

  // data chunk
  writeStr(v, 36, "data");
  v.setUint32(40, dataLength, true);

  for (let i = 0; i < samples.length; i++) {
    v.setInt16(44 + i * 2, samples[i], true);
  }

  return buffer;
}

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
