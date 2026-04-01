/**
 * AudioWorklet processor for Scribe real-time transcription.
 * Downsamples from native sample rate (typically 48 kHz) to 16 kHz
 * and batches into ~250 ms chunks to avoid overwhelming the WebSocket.
 *
 * Runs on a dedicated audio thread — immune to main-thread React render jank.
 */

const SCRIBE_SAMPLE_RATE = 16000;
const CHUNK_SIZE = 4000; // 250ms at 16 kHz

class ScribeProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { nativeSampleRate } = options.processorOptions;
    this._ratio = nativeSampleRate / SCRIBE_SAMPLE_RATE;
    this._buf = new Float32Array(CHUNK_SIZE);
    this._pos = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    // Downsample from native rate → 16 kHz
    const outLen = Math.floor(input.length / this._ratio);
    for (let i = 0; i < outLen; i++) {
      this._buf[this._pos++] = input[Math.floor(i * this._ratio)];
      if (this._pos >= CHUNK_SIZE) {
        this.port.postMessage(this._buf.slice(0, this._pos));
        this._pos = 0;
      }
    }
    return true;
  }
}

registerProcessor("scribe-processor", ScribeProcessor);
