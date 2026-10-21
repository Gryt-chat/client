/** What the beep script needs. Serialised into the page, so plain data only. */
export interface BeepConfig {
  /** This client's microphone becomes the beeper. The others listen. */
  send: boolean;
  periodMs: number;
  /** A listener's microphone becomes what it hears, so the beeper times a round trip on its own clock. */
  echo: boolean;
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

  /** Calls `onOnset` with Date.now() each time `track` goes loud after 300 ms of quiet. */
  const onsets = (track: MediaStreamTrack, onOnset: (at: number, peak: number) => void) => {
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
        onOnset(now, Math.round(peak * 1000) / 1000);
      } else if (!quietSince) quietSince = now;
      else if (now - quietSince > 300) armed = true;
    }, 2);
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
      if (!beeper) {
        beeper = start();
        // Before the app's processing, so tapped minus raw is the app's send pipeline alone.
        const raw = beeper.stream.getAudioTracks()[0];
        onsets(raw, (at, peak) => emit("beep.raw", { rawAt: at, peak }));
      }
      for (const track of stream.getAudioTracks()) {
        stream.removeTrack(track);
        track.stop();
      }
      stream.addTrack(beeper.stream.getAudioTracks()[0].clone());
      return stream;
    };

    // The track the app hands to WebRTC, after its own Web Audio processing: where the send pipeline ends.
    const tapped = new WeakSet<MediaStreamTrack>();
    const tap = (track: MediaStreamTrack | null) => {
      if (!track || track.kind !== "audio" || tapped.has(track)) return;
      tapped.add(track);
      onsets(track, (at, peak) => emit("beep.tapped", { tappedAt: at, track: track.id, peak }));
    };
    const addTrack = RTCPeerConnection.prototype.addTrack;
    RTCPeerConnection.prototype.addTrack = function (track, ...streams) {
      tap(track);
      return addTrack.call(this, track, ...streams);
    };
    const replaceTrack = RTCRtpSender.prototype.replaceTrack;
    RTCRtpSender.prototype.replaceTrack = function (track) {
      tap(track);
      return replaceTrack.call(this, track);
    };
    // With echo the beeper listens too: what comes back is the round trip.
    if (!config.echo) return;
  }

  const AUDIO_IN = [
    "ssrc", "jitter", "packetsReceived", "packetsLost", "jitterBufferDelay", "jitterBufferTargetDelay",
    "jitterBufferMinimumDelay", "jitterBufferEmittedCount", "concealedSamples", "insertedSamplesForDeceleration",
    "removedSamplesForAcceleration", "totalSamplesReceived",
  ];

  // GRYT_SOAK_ECHO=1: two machines have two clocks, so the listener sends back what it hears and the beeper times that.
  let echo: ((track: MediaStreamTrack) => void) | null = null;
  if (config.echo && !config.send) {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const out = ctx.createMediaStreamDestination();
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await original(constraints);
      if (!constraints?.audio) return stream;
      for (const track of stream.getAudioTracks()) {
        stream.removeTrack(track);
        track.stop();
      }
      stream.addTrack(out.stream.getAudioTracks()[0].clone());
      return stream;
    };
    echo = (track) => {
      ctx.resume().catch(() => undefined);
      ctx.createMediaStreamSource(new MediaStream([track])).connect(out);
    };
    onsets(out.stream.getAudioTracks()[0], (at, peak) => emit("beep.echoed", { echoedAt: at, peak }));
  }

  const listen = (track: MediaStreamTrack, pc: RTCPeerConnection) => {
    echo?.(track);
    return onsets(track, (heardAt, peak) => {
      pc.getStats(track).then(
        (report) => {
          let stats: Loose | null = null;
          report.forEach((entry: Loose) => {
            if (entry.type !== "inbound-rtp" || entry.kind !== "audio") return;
            stats = {};
            for (const key of AUDIO_IN) if (entry[key] !== undefined) stats[key] = entry[key];
          });
          emit("beep.heard", { heardAt, track: track.id, peak, stats });
        },
        () => emit("beep.heard", { heardAt, track: track.id, peak, stats: null }),
      );
    });
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

  // The own voice transport (GRYT-1818) plays from a worklet, not a WebRTC track. Tapped through a track so it pays the same hop.
  const Worklet = w.AudioWorkletNode as typeof AudioWorkletNode;
  class BeepWorklet extends Worklet {
    constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
      super(context, name, options);
      if (name !== "gryt-transport-receive" || !(context instanceof AudioContext)) return;
      const out = context.createMediaStreamDestination();
      this.connect(out);
      const [track] = out.stream.getAudioTracks();
      echo?.(track);
      onsets(track, (heardAt, peak) => emit("beep.heard", { heardAt, track: track.id, peak, stats: null, transport: true }));
    }
  }
  Object.defineProperty(w, "AudioWorkletNode", { value: BeepWorklet, configurable: true, writable: true });
}
