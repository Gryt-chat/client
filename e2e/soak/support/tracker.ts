import type { Fields, JsonlLog } from "./jsonl";

/** The page opens two kinds of WebSocket: socket.io to the server, and the SFU's signalling. */
export function socketKind(url: string): "server" | "sfu" {
  return url.includes("/socket.io/") ? "server" : "sfu";
}

/** socket.io's reasons for a drop nobody asked for. The rest are a client or server hanging up on purpose. */
export const UNPLANNED = new Set(["transport close", "transport error", "ping timeout", "parse error"]);

interface Counts {
  serverDrops: number;
  sfuDrops: number;
  iceDrops: number;
}

/** Wraps a log and keeps just enough state for the once-a-minute status line. */
export class Tracker {
  readonly log: JsonlLog;
  readonly who: string;
  readonly counts: Counts = { serverDrops: 0, sfuDrops: 0, iceDrops: 0 };
  private serverUp = new Map<string, boolean>();
  private sfuOpen = 0;
  private ice = new Map<number, string>();
  private last: { rtt?: number; aob?: number; audioIn?: number; audioFlowing?: number } = {};
  private audioSeen = new Map<string, number>();
  inVoice: boolean | null = null;

  constructor(log: JsonlLog, who: string) {
    this.log = log;
    this.who = who;
  }

  write(type: string, fields: Fields = {}): void {
    this.log.write(type, fields);
    this.observe(type, fields);
  }

  private observe(type: string, f: Fields): void {
    const url = String(f.uri ?? f.url ?? "");
    if (type === "sio.connect") this.serverUp.set(url, true);
    if (type === "sio.disconnect") {
      if (UNPLANNED.has(String(f.reason))) this.counts.serverDrops++;
      this.serverUp.set(url, false);
    }
    if (type === "ws.open" && socketKind(url) === "sfu") this.sfuOpen++;
    if (type === "ws.close" && socketKind(url) === "sfu" && f.upMs !== null && f.upMs !== undefined) {
      this.sfuOpen = Math.max(0, this.sfuOpen - 1);
      if (f.byPageMsAgo === null || f.byPageMsAgo === undefined) this.counts.sfuDrops++;
    }
    if (type === "pc.ice") {
      const pid = Number(f.pid);
      const before = this.ice.get(pid);
      const state = String(f.state);
      if ((before === "connected" || before === "completed") && (state === "disconnected" || state === "failed")) this.counts.iceDrops++;
      this.ice.set(pid, state);
    }
    if (type === "stats") this.observeStats(f);
  }

  private observeStats(f: Fields): void {
    const pair = f.pair as Fields | undefined;
    if (pair) {
      this.last.rtt = typeof pair.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : undefined;
      this.last.aob = typeof pair.availableOutgoingBitrate === "number" ? pair.availableOutgoingBitrate : undefined;
    }
    const audio = (f.inAudio as Fields[] | undefined) ?? [];
    let flowing = 0;
    for (const a of audio) {
      const key = `${f.pid}/${a.ssrc}`;
      const packets = Number(a.packetsReceived ?? 0);
      if (packets > (this.audioSeen.get(key) ?? -1)) flowing++;
      this.audioSeen.set(key, packets);
    }
    this.last.audioIn = audio.length;
    this.last.audioFlowing = flowing;
  }

  status(): string {
    const servers = [...this.serverUp.values()];
    const sio = servers.length === 0 ? "sio -" : servers.every(Boolean) ? "sio up" : "sio DOWN";
    const ice = [...this.ice.values()].filter((s) => s !== "closed");
    const media = ice.length === 0 ? "" : ` ice ${ice.join("/")} rtt ${this.last.rtt ?? "?"}ms aob ${this.last.aob ? Math.round(this.last.aob / 1000) + "k" : "?"} audio ${this.last.audioFlowing ?? 0}/${this.last.audioIn ?? 0}`;
    const voice = this.inVoice === null ? "" : this.inVoice ? " voice in" : " voice OUT";
    const { serverDrops, sfuDrops, iceDrops } = this.counts;
    return `${this.who.padEnd(14)} ${sio} sfu-ws ${this.sfuOpen}${voice}${media}  drops sio ${serverDrops} sfu ${sfuDrops} ice ${iceDrops}`;
  }
}
