/** What the page script needs from the harness. Serialised into every page, so plain data only. */
export interface PageScriptConfig {
  /** URL prefixes to swap before a WebSocket opens, e.g. the SFU's public address for its LAN one. */
  rewrite: [string, string][];
  statsIntervalMs: number;
}

type Loose = Record<string, unknown>;

/**
 * Runs before the app in every document and reports socket.io, WebSocket, RTCPeerConnection and console
 * events through `window.__soakEmit`. Self-contained, because Playwright sends it to the page as source.
 */
export function soakPageScript(config: PageScriptConfig): void {
  const w = window as unknown as Loose & Window;
  const queue: Loose[] = [];
  type Sink = (e: Loose) => Promise<void>;

  const emit = (type: string, data: Loose = {}) => {
    const event = { at: Date.now(), type, ...data };
    const sink = w.__soakEmit as Sink | undefined;
    if (typeof sink === "function") sink(event).catch(() => undefined);
    else queue.push(event);
  };
  setInterval(() => {
    const sink = w.__soakEmit as Sink | undefined;
    if (typeof sink !== "function") return;
    for (const event of queue.splice(0)) sink(event).catch(() => undefined);
  }, 1000);

  const describe = (value: unknown, depth = 0): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value !== "object") return typeof value === "string" ? value.slice(0, 300) : value;
    if (depth > 2) return "[deep]";
    const v = value as Loose;
    if (typeof Event !== "undefined" && value instanceof Event) {
      return { event: value.type, code: v.code, reason: v.reason, wasClean: v.wasClean };
    }
    const out: Loose = value instanceof Error ? { name: value.name, message: value.message } : {};
    for (const key of ["type", "description", "context", "code", "reason", "wasClean", "message"]) {
      if (key in v && v[key] !== undefined && !(key in out)) out[key] = describe(v[key], depth + 1);
    }
    return out;
  };

  // socket.io: catch each Socket while its constructor runs, by a field only it assigns.
  const hookedSockets = new WeakSet<object>();
  const hookedManagers = new WeakSet<object>();
  let socketSeq = 0;
  type On = (event: string, fn: (...args: unknown[]) => void) => void;

  const hookSocket = (s: Loose) => {
    if (hookedSockets.has(s) || typeof s.on !== "function" || !s.io || typeof s.nsp !== "string") return;
    hookedSockets.add(s);
    const on = (s.on as On).bind(s);
    const manager = s.io as Loose;
    const managerOn = (manager.on as On).bind(manager);
    const uri = String(manager.uri ?? "");
    const sid = ++socketSeq;
    const state = { id: null as string | null, connectedAt: 0, droppedAt: 0, lastPingAt: 0 };
    emit("sio.new", { sid, uri, nsp: s.nsp });

    on("connect", () => {
      state.id = (s.id as string) ?? null;
      state.connectedAt = Date.now();
      const transport = (manager.engine as Loose | undefined)?.transport as Loose | undefined;
      const downMs = state.droppedAt ? state.connectedAt - state.droppedAt : null;
      emit("sio.connect", { sid, uri, id: state.id, recovered: !!s.recovered, transport: transport?.name ?? null, downMs });
    });
    on("disconnect", (reason: unknown, details: unknown) => {
      state.droppedAt = Date.now();
      emit("sio.disconnect", {
        sid,
        uri,
        id: state.id,
        reason,
        details: describe(details),
        active: !!s.active,
        upMs: state.connectedAt ? state.droppedAt - state.connectedAt : null,
        lastPingAgoMs: state.lastPingAt ? state.droppedAt - state.lastPingAt : null,
      });
    });
    on("connect_error", (err: unknown) => emit("sio.connect_error", { sid, uri, error: describe(err) }));
    managerOn("ping", () => {
      state.lastPingAt = Date.now();
    });

    if (hookedManagers.has(manager)) return;
    hookedManagers.add(manager);
    managerOn("reconnect_attempt", (n: unknown) => emit("sio.reconnect_attempt", { uri, attempt: n }));
    managerOn("reconnect", (n: unknown) => emit("sio.reconnect", { uri, attempt: n }));
    managerOn("reconnect_error", (e: unknown) => emit("sio.reconnect_error", { uri, error: describe(e) }));
    managerOn("reconnect_failed", () => emit("sio.reconnect_failed", { uri }));
    managerOn("close", (reason: unknown, description: unknown) =>
      emit("sio.engine_close", { uri, reason, description: describe(description) }),
    );
  };

  try {
    Object.defineProperty(Object.prototype, "_queueSeq", {
      configurable: true,
      enumerable: false,
      get() {
        return undefined;
      },
      set(value: unknown) {
        Object.defineProperty(this, "_queueSeq", { value, writable: true, configurable: true, enumerable: true });
        const target = this as Loose;
        queueMicrotask(() => hookSocket(target));
      },
    });
  } catch (err) {
    emit("soak.hook_failed", { what: "socket.io", error: describe(err) });
  }

  // WebSocket: every one the page opens, with its close code and whether the page closed it.
  const NativeWebSocket = window.WebSocket;
  let wsSeq = 0;
  interface WsState {
    wid: number;
    openedAt: number;
    lastRecv: number;
    lastSend: number;
    pageClosedAt: number;
  }
  const wsState = new WeakMap<WebSocket, WsState>();

  class SoakWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const asked = String(url);
      let target = asked;
      for (const [from, to] of config.rewrite) {
        if (target.startsWith(from)) target = to + target.slice(from.length);
      }
      super(target, protocols);
      const state: WsState = { wid: ++wsSeq, openedAt: 0, lastRecv: 0, lastSend: 0, pageClosedAt: 0 };
      const { wid } = state;
      const opened = Date.now();
      wsState.set(this, state);
      emit("ws.new", { wid, url: target, rewrittenFrom: target === asked ? undefined : asked });
      // The socket.io hook rides on a private field name; say so if a new client version renames it.
      if (target.includes("/socket.io/")) {
        setTimeout(() => {
          if (socketSeq === 0) emit("soak.hook_failed", { what: "socket.io", url: target });
        }, 2000);
      }
      this.addEventListener("open", () => {
        state.openedAt = Date.now();
        emit("ws.open", { wid, url: target, ms: state.openedAt - opened });
      });
      this.addEventListener("message", () => {
        state.lastRecv = Date.now();
      });
      this.addEventListener("error", () => emit("ws.error", { wid, url: target, readyState: this.readyState }));
      this.addEventListener("close", (e) => {
        const now = Date.now();
        emit("ws.close", {
          wid,
          url: target,
          code: e.code,
          reason: e.reason,
          wasClean: e.wasClean,
          byPageMsAgo: state.pageClosedAt ? now - state.pageClosedAt : null,
          upMs: state.openedAt ? now - state.openedAt : null,
          lastRecvAgoMs: state.lastRecv ? now - state.lastRecv : null,
          lastSendAgoMs: state.lastSend ? now - state.lastSend : null,
        });
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      const state = wsState.get(this);
      if (state) state.lastSend = Date.now();
      return super.send(data);
    }

    close(code?: number, reason?: string) {
      const state = wsState.get(this);
      if (state && !state.pageClosedAt) {
        state.pageClosedAt = Date.now();
        const stack = (new Error().stack ?? "").split("\n").slice(2, 6).map((l) => l.trim()).join(" | ");
        emit("ws.page_close", { wid: state.wid, url: this.url, code, reason, readyState: this.readyState, stack });
      }
      return super.close(code, reason);
    }
  }
  Object.defineProperty(w, "WebSocket", { value: SoakWebSocket, configurable: true, writable: true });

  // RTCPeerConnection: states, the pair ICE picked, and a getStats sample on a timer.
  const NativePeer = window.RTCPeerConnection;
  const peers = new Set<RTCPeerConnection>();
  const peerIds = new WeakMap<RTCPeerConnection, number>();
  let peerSeq = 0;

  // Only the far end's address is kept. This machine's own addresses stay out of the log.
  const candidate = (c: Loose | undefined, local: boolean) =>
    c && {
      type: c.candidateType ?? c.type,
      protocol: c.protocol,
      address: local ? undefined : (c.address ?? c.ip),
      port: local ? undefined : c.port,
      networkType: c.networkType,
    };

  type IceTransport = RTCIceTransport & { getSelectedCandidatePair?: () => { local?: Loose; remote?: Loose } | null; __soak?: boolean };
  const watchPair = (pc: RTCPeerConnection, pid: number) => {
    const transport = pc.getSenders().find((s) => s.transport)?.transport ?? pc.getReceivers().find((r) => r.transport)?.transport;
    const ice = transport?.iceTransport as IceTransport | undefined;
    if (!ice || ice.__soak) return;
    ice.__soak = true;
    const report = () => {
      const pair = ice.getSelectedCandidatePair?.();
      emit("pc.pair", { pid, local: candidate(pair?.local as Loose | undefined, true), remote: candidate(pair?.remote as Loose | undefined, false) });
    };
    ice.addEventListener("selectedcandidatepairchange", report);
    ice.addEventListener("statechange", () => emit("pc.ice_transport", { pid, state: ice.state }));
    report();
  };

  class SoakPeer extends NativePeer {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      const pid = ++peerSeq;
      peers.add(this);
      peerIds.set(this, pid);
      const iceServers = (configuration?.iceServers ?? []).map((s) => [s.urls].flat().join(","));
      emit("pc.new", { pid, iceServers, iceTransportPolicy: configuration?.iceTransportPolicy });
      this.addEventListener("connectionstatechange", () => {
        emit("pc.state", { pid, state: this.connectionState });
        if (this.connectionState === "connected") watchPair(this, pid);
        if (this.connectionState === "closed") peers.delete(this);
      });
      this.addEventListener("iceconnectionstatechange", () => emit("pc.ice", { pid, state: this.iceConnectionState }));
      this.addEventListener("signalingstatechange", () => emit("pc.signaling", { pid, state: this.signalingState }));
      this.addEventListener("icegatheringstatechange", () => emit("pc.gathering", { pid, state: this.iceGatheringState }));
      this.addEventListener("icecandidateerror", (e) => {
        const err = e as RTCPeerConnectionIceErrorEvent;
        emit("pc.candidate_error", { pid, code: err.errorCode, text: err.errorText, url: err.url });
      });
      this.addEventListener("track", (e) => {
        const streams = e.streams.map((s) => s.id);
        emit("pc.track", { pid, kind: e.track.kind, track: e.track.id, streams, mid: e.transceiver?.mid });
      });
    }

    close() {
      emit("pc.close", { pid: peerIds.get(this) });
      peers.delete(this);
      return super.close();
    }
  }
  Object.defineProperty(w, "RTCPeerConnection", { value: SoakPeer, configurable: true, writable: true });

  const pick = (entry: Loose, keys: string[]) => {
    const out: Loose = {};
    for (const key of keys) {
      const value = entry[key];
      if (value === undefined) continue;
      out[key] = typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 1e6) / 1e6 : value;
    }
    return out;
  };

  const RTP = [
    "ssrc", "mid", "trackIdentifier", "packetsReceived", "packetsLost", "jitter", "bytesReceived", "nackCount",
    "firCount", "pliCount", "lastPacketReceivedTimestamp", "jitterBufferDelay", "jitterBufferTargetDelay",
    "jitterBufferMinimumDelay", "jitterBufferEmittedCount",
  ];
  const AUDIO_IN = [
    ...RTP, "concealedSamples", "silentConcealedSamples", "concealmentEvents", "totalSamplesReceived",
    "insertedSamplesForDeceleration", "removedSamplesForAcceleration", "audioLevel", "totalSamplesDuration",
  ];
  const VIDEO_IN = [
    ...RTP, "framesReceived", "framesDecoded", "framesDropped", "keyFramesDecoded", "frameWidth", "frameHeight",
    "framesPerSecond", "freezeCount", "totalFreezesDuration", "pauseCount", "totalPausesDuration",
  ];
  const OUT = [
    "ssrc", "kind", "mid", "rid", "active", "packetsSent", "bytesSent", "retransmittedPacketsSent", "nackCount",
    "firCount", "pliCount", "framesEncoded", "framesSent", "frameWidth", "frameHeight", "framesPerSecond",
    "qualityLimitationReason", "targetBitrate",
  ];
  const REMOTE_IN = ["ssrc", "kind", "roundTripTime", "totalRoundTripTime", "roundTripTimeMeasurements", "fractionLost", "packetsLost", "jitter"];
  const PAIR = [
    "state", "currentRoundTripTime", "totalRoundTripTime", "responsesReceived", "requestsSent", "consentRequestsSent",
    "availableOutgoingBitrate", "availableIncomingBitrate", "bytesSent", "bytesReceived", "packetsSent",
    "packetsReceived", "packetsDiscardedOnSend", "lastPacketReceivedTimestamp", "lastPacketSentTimestamp",
  ];
  const PLAYOUT = ["synthesizedSamplesDuration", "synthesizedSamplesEvents", "totalSamplesDuration", "totalPlayoutDelay", "totalSamplesCount"];

  const sample = async (pc: RTCPeerConnection) => {
    const byId = new Map<string, Loose>();
    (await pc.getStats()).forEach((entry: Loose) => byId.set(entry.id as string, entry));
    const inAudio: Loose[] = [];
    const inVideo: Loose[] = [];
    const out: Loose[] = [];
    const remoteIn: Loose[] = [];
    const result: Loose = { pid: peerIds.get(pc), state: pc.connectionState, ice: pc.iceConnectionState, inAudio, inVideo, out, remoteIn };
    for (const entry of byId.values()) {
      if (entry.type === "transport") {
        result.transport = pick(entry, ["dtlsState", "iceState", "selectedCandidatePairChanges", "bytesSent", "bytesReceived"]);
        const pair = byId.get(entry.selectedCandidatePairId as string);
        if (pair) {
          const local = candidate(byId.get(pair.localCandidateId as string), true);
          const remote = candidate(byId.get(pair.remoteCandidateId as string), false);
          result.pair = { ...pick(pair, PAIR), local, remote };
        }
      } else if (entry.type === "inbound-rtp") {
        if (entry.kind === "audio") inAudio.push(pick(entry, AUDIO_IN));
        else inVideo.push(pick(entry, VIDEO_IN));
      } else if (entry.type === "outbound-rtp") {
        out.push(pick(entry, OUT));
      } else if (entry.type === "remote-inbound-rtp") {
        remoteIn.push(pick(entry, REMOTE_IN));
      } else if (entry.type === "media-playout") {
        result.playout = pick(entry, PLAYOUT);
      }
    }
    return result;
  };

  setInterval(() => {
    for (const pc of peers) {
      if (pc.connectionState === "closed") {
        peers.delete(pc);
        continue;
      }
      sample(pc).then(
        (s) => emit("stats", s),
        (err) => emit("stats.error", { pid: peerIds.get(pc), error: describe(err) }),
      );
    }
  }, config.statsIntervalMs);

  // The console, read here rather than through Playwright, which can't keep up with the camera
  // effect's four lines a second. A line seen again within the minute is counted, not repeated.
  const repeats = new Map<string, { level: string; text: string; count: number }>();
  const stringify = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    try {
      return (JSON.stringify(value) ?? String(value)).slice(0, 500);
    } catch {
      return String(value);
    }
  };
  const format = (args: unknown[]) => {
    const [first, ...rest] = args;
    if (typeof first !== "string") return args.map(stringify).join(" ");
    let css = (first.match(/%c/g) ?? []).length;
    const kept = rest.filter((arg) => !(css > 0 && typeof arg === "string" && css-- > 0));
    return [first.replace(/%c/g, ""), ...kept.map(stringify)].join(" ");
  };
  const template = (text: string) =>
    text
      .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]/g, "")
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
      .replace(/\b[0-9a-z_-]{16,}\b/gi, "<id>")
      .replace(/\d+(\.\d+)?/g, "#")
      .slice(0, 200);
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        const text = format(args);
        const key = `${level}|${template(text)}`;
        const seen = repeats.get(key);
        if (seen) seen.count++;
        else {
          repeats.set(key, { level, text: text.slice(0, 300), count: 0 });
          emit("console", { level, text: text.slice(0, 1500) });
        }
      } catch {
        // Logging must never break the app.
      }
      original(...args);
    };
  }
  setInterval(() => {
    for (const { level, text, count } of repeats.values()) {
      if (count > 0) emit("console.repeat", { level, text, count, withinMs: 60_000 });
    }
    repeats.clear();
  }, 60_000);
  w.addEventListener("unhandledrejection", (e) => emit("page.rejection", { reason: describe(e.reason) }));

  document.addEventListener("visibilitychange", () => emit("page.visibility", { state: document.visibilityState }));
  w.addEventListener("online", () => emit("page.online", { online: true }));
  w.addEventListener("offline", () => emit("page.online", { online: false }));
}
