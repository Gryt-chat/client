/** GRYT_SOAK_RECORD=1: a listener keeps what it hears as raw stereo floats, the own transport's playback and
    WebRTC's alike, so a call can be listened to afterwards. Self-contained, like the soak script. */
export function recordScript(): void {
  const w = window as unknown as Record<string, unknown> & Window;
  const RECORDER = `registerProcessor("gryt-soak-recorder", class extends AudioWorkletProcessor {
    process(inputs) {
      const i = inputs[0];
      if (i && i[0]) this.port.postMessage([i[0].slice(), (i[1] || i[0]).slice()]);
      return true;
    }
  });`;
  // Kept apart per source: on the own transport, WebRTC's track is still there but silent.
  const sources = { transport: [] as Float32Array[][], webrtc: [] as Float32Array[][] };
  const contexts = new WeakMap<BaseAudioContext, Promise<void>>();
  const record = async (context: AudioContext, node: AudioNode, chunks: Float32Array[][]) => {
    let ready = contexts.get(context);
    if (!ready) {
      ready = context.audioWorklet.addModule(URL.createObjectURL(new Blob([RECORDER], { type: "text/javascript" })));
      contexts.set(context, ready);
    }
    await ready;
    const recorder = new AudioWorkletNode(context, "gryt-soak-recorder", { channelCount: 2, channelCountMode: "explicit" });
    recorder.port.onmessage = (e: MessageEvent<Float32Array[]>) => chunks.push(e.data);
    node.connect(recorder);
  };

  // Interleaved stereo, base64, from the last `seconds` heard.
  Object.defineProperty(w, "__soakRecording", {
    value: (seconds: number) => {
      const energy = (c: Float32Array[][]) => c.reduce((s, [l]) => s + l.reduce((a, v) => a + v * v, 0), 0);
      const chunks = energy(sources.transport) >= energy(sources.webrtc) ? sources.transport : sources.webrtc;
      const frames = chunks.flatMap(([l, r]) => Array.from(l, (v, i) => [v, r[i]])).slice(-seconds * 48000);
      const bytes = new Uint8Array(Float32Array.from(frames.flat()).buffer);
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
  });

  const Worklet = w.AudioWorkletNode as typeof AudioWorkletNode;
  class RecordedWorklet extends Worklet {
    constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
      super(context, name, options);
      if (name === "gryt-transport-receive" && context instanceof AudioContext) void record(context, this, sources.transport);
    }
  }
  Object.defineProperty(w, "AudioWorkletNode", { value: RecordedWorklet, configurable: true, writable: true });

  const Peer = w.RTCPeerConnection as typeof RTCPeerConnection;
  class RecordedPeer extends Peer {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      this.addEventListener("track", (e) => {
        if (e.track.kind !== "audio") return;
        // Chromium only feeds a remote track into Web Audio while a media element holds it too.
        const holder = new Audio();
        holder.muted = true;
        holder.srcObject = new MediaStream([e.track]);
        holder.play().catch(() => undefined);
        const context = new AudioContext({ sampleRate: 48000 });
        void record(context, context.createMediaStreamSource(new MediaStream([e.track])), sources.webrtc);
      });
    }
  }
  Object.defineProperty(w, "RTCPeerConnection", { value: RecordedPeer, configurable: true, writable: true });
}
