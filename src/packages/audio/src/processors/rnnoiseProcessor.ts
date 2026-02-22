const RNNOISE_WORKLET_NAME = 'rnnoise-processor';
const MAX_OUTPUT_QUEUE = 8;

const WORKLET_CODE = /* js */ `
class RNNoiseWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this._FRAME = 480;
    this._in = new Float32Array(this._FRAME);
    this._inIdx = 0;
    this._outQ = [];
    this._outFrame = null;
    this._outIdx = 0;
    this._on = false;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'processed') {
        if (this._outQ.length >= ${MAX_OUTPUT_QUEUE}) this._outQ.shift();
        this._outQ.push(new Float32Array(d.frame));
      } else if (d.type === 'enable') {
        this._on = d.enabled;
        if (!d.enabled) {
          this._outQ.length = 0;
          this._outFrame = null;
          this._outIdx = 0;
        }
      }
    };
  }

  process(inputs, outputs) {
    const src = inputs[0] && inputs[0][0];
    const dst = outputs[0] && outputs[0][0];
    if (!src || !dst) return true;

    if (!this._on) {
      dst.set(src);
      return true;
    }

    for (let i = 0; i < src.length; i++) {
      this._in[this._inIdx++] = src[i];
      if (this._inIdx >= this._FRAME) {
        const buf = this._in;
        this._in = new Float32Array(this._FRAME);
        this._inIdx = 0;
        this.port.postMessage({ type: 'frame', frame: buf.buffer }, [buf.buffer]);
      }
    }

    for (let i = 0; i < dst.length; i++) {
      if (!this._outFrame || this._outIdx >= this._FRAME) {
        if (this._outQ.length > 0) {
          this._outFrame = this._outQ.shift();
          this._outIdx = 0;
        } else {
          dst[i] = 0;
          continue;
        }
      }
      dst[i] = this._outFrame[this._outIdx++];
    }

    return true;
  }
}
registerProcessor('${RNNOISE_WORKLET_NAME}', RNNoiseWorkletProcessor);
`;

let workletRegistered = false;

async function ensureWorkletRegistered(ctx: AudioContext): Promise<void> {
  if (workletRegistered) return;
  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
    workletRegistered = true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class RNNoiseProcessor {
  private node: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private enabled = false;

  async initialize(audioContext: AudioContext): Promise<void> {
    await ensureWorkletRegistered(audioContext);

    this.node = new AudioWorkletNode(audioContext, RNNOISE_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });

    this.worker = new Worker(
      new URL('./rnnoiseWorker.ts', import.meta.url),
      { type: 'module' },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('RNNoise worker init timeout')),
        15_000,
      );
      this.worker!.onmessage = (e) => {
        if (e.data.type === 'ready') {
          clearTimeout(timeout);
          resolve();
        } else if (e.data.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(e.data.message));
        }
      };
      this.worker!.postMessage({ type: 'init' });
    });

    // Route frames: worklet → worker → worklet (main thread is just a relay)
    this.node.port.onmessage = (e) => {
      if (e.data.type === 'frame' && this.worker && this.enabled) {
        this.worker.postMessage(
          { type: 'process', frame: e.data.frame },
          [e.data.frame],
        );
      }
    };

    this.worker.onmessage = (e) => {
      if (e.data.type === 'processed' && this.node) {
        this.node.port.postMessage(
          { type: 'processed', frame: e.data.frame },
          [e.data.frame],
        );
      }
    };
  }

  getNode(): AudioWorkletNode | null {
    return this.node;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.node?.port.postMessage({ type: 'enable', enabled });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    this.enabled = false;
    this.worker?.postMessage({ type: 'destroy' });
    this.worker?.terminate();
    this.worker = null;
    try { this.node?.disconnect(); } catch { /* already disconnected */ }
    this.node = null;
  }
}
