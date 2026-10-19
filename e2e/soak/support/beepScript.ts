/** What the beep script needs. Serialised into the page, so plain data only. */
export interface BeepConfig {
  /** This client's microphone becomes the beeper. The others listen. */
  send: boolean;
  periodMs: number;
}

type Loose = Record<string, unknown>;

/** Voice delay over a long call (voice#53): the sender's mic beeps at 1 kHz, each listener stamps the onset,
    and both clocks are this machine's Date.now(). Self-contained, like the soak script. */
export function beepScript(config: BeepConfig): void {
  const w = window as unknown as Loose & Window;
  const emit = (type: string, data: Loose) => {
    const sink = w.__soakEmit as ((e: Loose) => Promise<void>) | undefined;
    if (typeof sink === "function") sink({ at: Date.now(), type, ...data }).catch(() => undefined);
  };

  if (config.send) {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let beeper: MediaStreamAudioDestinationNode | null = null;

    const start = () => {
      const ctx = new AudioContext({ sampleRate: 48000 });
      const osc = ctx.createOscillator();
      osc.frequency.value = 1000;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const out = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(out);
      osc.start();
      let seq = 0;
      setInterval(() => {
        if (ctx.state !== "running") {
          ctx.resume().catch(() => undefined);
          return;
        }
        // Scheduled 50 ms ahead on the audio clock, and the wall time worked out from the same reading.
        const lead = 0.05;
        const t = ctx.currentTime + lead;
        const sentAt = Date.now() + lead * 1000;
        gain.gain.setValueAtTime(0.8, t);
        gain.gain.setValueAtTime(0, t + 0.08);
        emit("beep.sent", { seq: ++seq, sentAt });
      }, config.periodMs);
      return out;
    };

    navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await original(constraints);
      if (!constraints?.audio) return stream;
      beeper ??= start();
      for (const track of stream.getAudioTracks()) {
        stream.removeTrack(track);
        track.stop();
      }
      stream.addTrack(beeper.stream.getAudioTracks()[0].clone());
      return stream;
    };
    return;
  }

  const AUDIO_IN = [
    "ssrc", "jitter", "packetsReceived", "packetsLost", "jitterBufferDelay", "jitterBufferTargetDelay",
    "jitterBufferMinimumDelay", "jitterBufferEmittedCount", "concealedSamples", "insertedSamplesForDeceleration",
    "removedSamplesForAcceleration", "totalSamplesReceived",
  ];

  const listen = (track: MediaStreamTrack, pc: RTCPeerConnection) => {
    // Chromium only feeds a remote track into Web Audio while a media element holds it too.
    const holder = new Audio();
    holder.muted = true;
    holder.srcObject = new MediaStream([track]);
    holder.play().catch(() => undefined);

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let armed = true;
    let quietSince = 0;

    const timer = setInterval(() => {
      if (track.readyState === "ended") return clearInterval(timer);
      if (ctx.state !== "running") {
        ctx.resume().catch(() => undefined);
        return;
      }
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      const now = Date.now();
      if (peak > 0.2) {
        quietSince = 0;
        if (!armed) return;
        armed = false;
        pc.getStats(track).then(
          (report) => {
            let stats: Loose | null = null;
            report.forEach((s: Loose) => {
              if (s.type !== "inbound-rtp" || s.kind !== "audio") return;
              stats = {};
              for (const key of AUDIO_IN) if (s[key] !== undefined) stats[key] = s[key];
            });
            emit("beep.heard", { heardAt: now, track: track.id, peak: Math.round(peak * 1000) / 1000, stats });
          },
          () => emit("beep.heard", { heardAt: now, track: track.id, peak, stats: null }),
        );
      } else if (!quietSince) quietSince = now;
      else if (now - quietSince > 300) armed = true;
    }, 2);
  };

  const Peer = w.RTCPeerConnection as typeof RTCPeerConnection;
  class BeepPeer extends Peer {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      this.addEventListener("track", (e) => {
        if (e.track.kind === "audio") listen(e.track, this);
      });
    }
  }
  Object.defineProperty(w, "RTCPeerConnection", { value: BeepPeer, configurable: true, writable: true });
}
