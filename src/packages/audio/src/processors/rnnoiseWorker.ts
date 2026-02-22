import { DenoiseState,Rnnoise } from '@shiguredo/rnnoise-wasm';

let denoiseState: DenoiseState | null = null;
const FRAME_SIZE = 480;
const PCM_SCALE = 32768;

async function init() {
  const rnnoise = await Rnnoise.load();
  denoiseState = rnnoise.createDenoiseState();
  self.postMessage({ type: 'ready' });
}

self.onmessage = (event: MessageEvent) => {
  const { type } = event.data;

  if (type === 'init') {
    init().catch((err) => {
      self.postMessage({ type: 'error', message: String(err) });
    });
    return;
  }

  if (type === 'process' && denoiseState) {
    const frame = new Float32Array(event.data.frame);
    if (frame.length !== FRAME_SIZE) return;

    // Web Audio uses float32 in [-1, 1]; RNNoise expects 16-bit PCM range [-32768, 32767]
    for (let i = 0; i < FRAME_SIZE; i++) {
      frame[i] *= PCM_SCALE;
    }

    denoiseState.processFrame(frame);

    for (let i = 0; i < FRAME_SIZE; i++) {
      frame[i] /= PCM_SCALE;
    }

    self.postMessage(
      { type: 'processed', frame: frame.buffer },
      { transfer: [frame.buffer as ArrayBuffer] },
    );
    return;
  }

  if (type === 'destroy') {
    denoiseState?.destroy();
    denoiseState = null;
  }
};
