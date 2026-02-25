/**
 * AudioWorklet processor that receives interleaved 16-bit PCM chunks via
 * its MessagePort and plays them back into the Web Audio graph.
 *
 * Expected input format: Int16, 2 channels, 48 kHz (matching the native binary).
 */

const PCM_PLAYER_WORKLET_NAME = "pcm-player-processor";

const WORKLET_CODE = /* js */ `
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Ring buffer: store Float32 samples per channel
    this._bufSize = 48000; // ~1 second at 48 kHz
    this._bufL = new Float32Array(this._bufSize);
    this._bufR = new Float32Array(this._bufSize);
    this._writePos = 0;
    this._readPos = 0;
    this._active = true;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "pcm") {
        this._enqueuePCM(msg.samples);
      } else if (msg.type === "stop") {
        this._active = false;
      }
    };
  }

  _enqueuePCM(int16Array) {
    const frames = int16Array.length / 2; // 2 channels interleaved
    for (let i = 0; i < frames; i++) {
      this._bufL[this._writePos] = int16Array[i * 2] / 32768;
      this._bufR[this._writePos] = int16Array[i * 2 + 1] / 32768;
      this._writePos = (this._writePos + 1) % this._bufSize;
    }
  }

  _available() {
    return (this._writePos - this._readPos + this._bufSize) % this._bufSize;
  }

  process(_inputs, outputs) {
    if (!this._active) return false;

    const outL = outputs[0]?.[0];
    const outR = outputs[0]?.[1];
    if (!outL) return true;

    const needed = outL.length; // 128 frames per render quantum
    const avail = this._available();

    if (avail < needed) {
      // Underrun — output silence
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    for (let i = 0; i < needed; i++) {
      outL[i] = this._bufL[this._readPos];
      if (outR) outR[i] = this._bufR[this._readPos];
      this._readPos = (this._readPos + 1) % this._bufSize;
    }

    return true;
  }
}

registerProcessor("${PCM_PLAYER_WORKLET_NAME}", PCMPlayerProcessor);
`;

let workletBlobUrl: string | null = null;

function getWorkletUrl(): string {
  if (!workletBlobUrl) {
    const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
    workletBlobUrl = URL.createObjectURL(blob);
  }
  return workletBlobUrl;
}

export { getWorkletUrl,PCM_PLAYER_WORKLET_NAME };
