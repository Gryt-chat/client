// Reads a soak run and lists every drop, grouped into incidents across clients and probes.
// Usage: node e2e/soak/report.mjs e2e/soak/runs/<run> [--json]

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node e2e/soak/report.mjs <run directory> [--json]");
  process.exit(1);
}
const asJson = process.argv.includes("--json");

const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
const UNPLANNED = new Set(["transport close", "transport error", "ping timeout", "parse error"]);
const INCIDENT_GAP_MS = 30_000;
const STALL_MIN_MS = 1_000;
const GLITCH_RATIO = 0.05;

/** Which group a URL belongs to, from the run's config. */
function groupOf(url, who) {
  for (const g of config.groups) {
    const hosts = [g.httpBase, g.sfu].filter(Boolean).map((u) => new URL(u).host);
    if (hosts.some((h) => url.includes(h))) return g.name;
  }
  // A call client's SFU socket goes wherever the server said, so fall back to the client's own group.
  return who.split("-")[0];
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The page opens two kinds of WebSocket: socket.io to the server, and the SFU's signalling. */
function kindOf(url) {
  return url.includes("/socket.io/") ? "server" : "sfu";
}

function read(file) {
  const events = [];
  for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      event.ts = Date.parse(event.t);
      events.push(event);
    } catch {
      // A line cut off by an interrupted run.
    }
  }
  return events;
}

const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
const byWho = new Map(files.map((f) => [f.replace(/\.jsonl$/, ""), read(f)]));
const drops = [];
const quality = [];
const network = [];

for (const [who, events] of byWho) {
  const role = who.startsWith("node-") ? "node" : who === "browser-probe" ? "browser" : who === "net" || who === "harness" ? who : "call";

  // Server sockets: a socket.io disconnect nobody asked for, until that socket is back.
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === "sio.disconnect" && UNPLANNED.has(e.reason)) {
      const uri = e.uri;
      const back = events.slice(i + 1).find((n) => n.type === "sio.connect" && n.uri === uri);
      const host = hostOf(uri);
      const close = events
        .slice(Math.max(0, i - 20), i + 20)
        .find((n) => n.type === "ws.close" && n.url?.includes("/socket.io/") && hostOf(n.url) === host && Math.abs(n.ts - e.ts) < 2000);
      drops.push({
        at: e.ts,
        who,
        role,
        group: groupOf(uri, who),
        what: "server socket",
        reason: e.reason,
        code: close?.code ?? e.details?.code ?? e.details?.context?.code,
        wasClean: close?.wasClean,
        lastRecvAgoMs: close?.lastRecvAgoMs ?? null,
        lastPingAgoMs: e.lastPingAgoMs,
        upMs: e.upMs,
        downMs: back ? back.ts - e.ts : null,
        // The id the server logs as `Client disconnected: <id>`.
        socketId: e.id,
      });
    }
    // SFU sockets: an open WebSocket to the SFU that this side didn't close.
    if (e.type === "ws.close" && kindOf(e.url ?? "") === "sfu" && e.upMs != null && e.byPageMsAgo == null) {
      const back = events.slice(i + 1).find((n) => n.type === "ws.open" && kindOf(n.url) === "sfu");
      drops.push({
        at: e.ts,
        who,
        role,
        group: groupOf(e.url, who),
        what: "sfu socket",
        reason: `close ${e.code}${e.reason ? ` ${e.reason}` : ""}`,
        code: e.code,
        wasClean: e.wasClean,
        lastRecvAgoMs: e.lastRecvAgoMs ?? null,
        upMs: e.upMs,
        downMs: back ? back.ts - e.ts : null,
      });
    }
  }

  // ICE: connected or completed, then disconnected or failed, until connected again.
  const ice = new Map();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type !== "pc.ice") continue;
    const before = ice.get(e.pid);
    ice.set(e.pid, e.state);
    if (!["connected", "completed"].includes(before) || !["disconnected", "failed"].includes(e.state)) continue;
    const back = events.slice(i + 1).find((n) => n.type === "pc.ice" && n.pid === e.pid && ["connected", "completed", "closed"].includes(n.state));
    drops.push({ at: e.ts, who, role, group: who.split("-")[0], what: "ice", reason: `ice ${e.state}${back?.state === "closed" ? ", then closed" : ""}`, downMs: back ? back.ts - e.ts : null });
  }

  // Out of the voice channel as the window shows it.
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type !== "ui.voice" || e.inVoice) continue;
    const back = events.slice(i + 1).find((n) => n.type === "ui.voice" && n.inVoice);
    // The browser closing at the end of a run takes the call with it, and that isn't a drop.
    const closing = events.find((n) => /^(browser\.disconnected|page\.close)$/.test(n.type) && Math.abs(n.ts - e.ts) < 5000);
    if (!back && closing) continue;
    drops.push({ at: e.ts, who, role, group: who.split("-")[0], what: "left call", reason: "not in the voice channel", downMs: back ? back.ts - e.ts : null });
  }

  // Audio that stopped arriving on a connected peer, from the five-second samples.
  const stats = events.filter((e) => e.type === "stats" && e.state === "connected");
  const last = new Map();
  const stalls = new Map();
  const q = { rtt: [], jitter: [], jb: [], aob: [], lost: 0, received: 0, concealed: 0, samples: 0, framesDropped: 0, pli: 0, nack: 0, freezes: 0 };
  for (const s of stats) {
    if (s.pair?.currentRoundTripTime != null) q.rtt.push(s.pair.currentRoundTripTime * 1000);
    if (s.pair?.availableOutgoingBitrate != null) q.aob.push(s.pair.availableOutgoingBitrate);
    for (const a of s.inAudio ?? []) {
      const key = `${s.pid}/${a.ssrc}`;
      const prev = last.get(key);
      last.set(key, { ...a, ts: s.ts });
      if (a.jitter != null) q.jitter.push(a.jitter * 1000);
      if (!prev) continue;
      const received = a.packetsReceived - prev.packetsReceived;
      q.received += Math.max(0, received);
      q.lost += Math.max(0, a.packetsLost - prev.packetsLost);
      const concealed = Math.max(0, a.concealedSamples - prev.concealedSamples);
      const samples = Math.max(0, a.totalSamplesReceived - prev.totalSamplesReceived);
      q.concealed += concealed;
      q.samples += samples;
      // More than a quarter of a second made up in five: a gap somebody would hear.
      if (received > 0 && samples > 0 && concealed / samples > GLITCH_RATIO) {
        const ms = Math.round((concealed / samples) * (s.ts - prev.ts));
        drops.push({ at: prev.ts, who, role, group: who.split("-")[0], what: "audio glitch", reason: `${ms} ms concealed on ${a.trackIdentifier?.slice(0, 8) ?? a.ssrc}`, downMs: ms });
      }
      const emitted = a.jitterBufferEmittedCount - prev.jitterBufferEmittedCount;
      if (emitted > 0) q.jb.push(((a.jitterBufferDelay - prev.jitterBufferDelay) / emitted) * 1000);
      if (received <= 0) {
        if (!stalls.has(key)) stalls.set(key, { from: prev.ts, to: s.ts });
        else stalls.get(key).to = s.ts;
      } else if (stalls.has(key)) {
        const stall = stalls.get(key);
        stalls.delete(key);
        if (stall.to - stall.from >= STALL_MIN_MS) {
          drops.push({ at: stall.from, who, role, group: who.split("-")[0], what: "audio stall", reason: `no audio packets on ${a.trackIdentifier?.slice(0, 8) ?? a.ssrc}`, downMs: s.ts - stall.from });
        }
      }
    }
    for (const v of s.inVideo ?? []) {
      const key = `v${s.pid}/${v.ssrc}`;
      const prev = last.get(key);
      last.set(key, v);
      if (!prev) continue;
      q.framesDropped += Math.max(0, (v.framesDropped ?? 0) - (prev.framesDropped ?? 0));
      q.pli += Math.max(0, (v.pliCount ?? 0) - (prev.pliCount ?? 0));
      q.nack += Math.max(0, (v.nackCount ?? 0) - (prev.nackCount ?? 0));
      q.freezes += Math.max(0, (v.freezeCount ?? 0) - (prev.freezeCount ?? 0));
    }
  }
  if (stats.length) quality.push({ who, samples: stats.length, ...q });

  // What the machine and the paths looked like meanwhile.
  for (const e of events) {
    if (e.type === "ping" && e.lost > 0) network.push({ at: e.ts, who, what: `ping ${e.host}: ${e.lost} lost in a minute` });
    if (e.type === "ping.lost") network.push({ at: e.ts, who, what: `ping ${e.host} lost` });
    if (e.type === "net.route") network.push({ at: e.ts, who, what: `${e.family} default route ${e.iface ? `back on ${e.iface}` : "gone"}` });
    if (e.type === "net.change") network.push({ at: e.ts, who, what: `addresses +${e.added.length} -${e.removed.length} (${[...e.added, ...e.removed].map((a) => a.split("/")[0]).join(",")})` });
    if (e.type === "http" && (e.error || e.ms > 2000)) network.push({ at: e.ts, who, what: `${e.url}: ${e.error ?? `${e.ms} ms`}` });
    if (e.type === "page.crash" || e.type === "browser.disconnected") network.push({ at: e.ts, who, what: e.type });
  }
}

drops.sort((a, b) => a.at - b.at);
network.sort((a, b) => a.at - b.at);

const incidents = [];
for (const drop of drops) {
  const current = incidents.at(-1);
  if (current && drop.at - current.end <= INCIDENT_GAP_MS) {
    current.drops.push(drop);
    current.end = Math.max(current.end, drop.at);
  } else {
    incidents.push({ start: drop.at, end: drop.at, drops: [drop] });
  }
}
for (const incident of incidents) {
  incident.network = network.filter((n) => n.at >= incident.start - 60_000 && n.at <= incident.end + 60_000);
}

const pct = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] * 10) / 10;
};

if (asJson) {
  console.log(JSON.stringify({ incidents, quality }, null, 2));
  process.exit(0);
}

const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");
const secs = (ms) => (ms == null ? "not back" : `${(ms / 1000).toFixed(1)} s`);
const harness = byWho.get("harness") ?? [];
const first = harness[0]?.ts;
const lastEvent = harness.at(-1)?.ts;
console.log(`Run ${dir}`);
if (first) console.log(`${iso(first)} to ${iso(lastEvent)}, ${Math.round((lastEvent - first) / 60000)} minutes\n`);

console.log("Drops by group, source and kind");
const counts = new Map();
for (const d of drops) {
  const key = `${d.group.padEnd(7)} ${d.role.padEnd(8)} ${d.what}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
for (const [key, n] of [...counts].sort()) console.log(`  ${key.padEnd(40)} ${n}`);
if (!counts.size) console.log("  none");

console.log(`\n${incidents.length} incident(s)`);
for (const [i, incident] of incidents.entries()) {
  const groups = [...new Set(incident.drops.map((d) => d.group))].join(", ");
  console.log(`\n#${i + 1} ${iso(incident.start)}  groups: ${groups}`);
  for (const d of incident.drops) {
    const extra = [
      d.code != null ? `code ${d.code}` : null,
      d.wasClean != null ? (d.wasClean ? "clean" : "not clean") : null,
      d.lastRecvAgoMs != null ? `last frame ${d.lastRecvAgoMs} ms before` : null,
      d.lastPingAgoMs != null ? `last ping at ${iso(d.at - d.lastPingAgoMs).slice(11)}` : null,
      d.socketId ? `id ${d.socketId}` : null,
      d.upMs != null ? `up ${Math.round(d.upMs / 60000)} min` : null,
    ].filter(Boolean);
    const who = d.role === "node" || d.role === "browser" ? `${d.role}/${d.group}` : d.who;
    console.log(`  ${iso(d.at).slice(11)} ${who.padEnd(16)} ${d.what.padEnd(13)} ${d.reason}; back in ${secs(d.downMs)}${extra.length ? ` (${extra.join(", ")})` : ""}`);
  }
  for (const n of incident.network) console.log(`  ${iso(n.at).slice(11)} ${n.who.padEnd(14)} ${n.what}`);
  const from = new Date(incident.start - 60_000).toISOString().slice(0, 19);
  const to = new Date(incident.end + 120_000).toISOString().slice(0, 19);
  console.log(`  logs: journalctl -o short-iso-precise --since "${from}Z" --until "${to}Z" CONTAINER_NAME=gryt-test-server (and gryt-test-sfu, -u cloudflared)`);
}

console.log("\nCall quality per client (five-second samples while connected)");
for (const q of quality) {
  const loss = q.received + q.lost ? ((100 * q.lost) / (q.received + q.lost)).toFixed(2) : "0";
  const concealed = q.samples ? ((100 * q.concealed) / q.samples).toFixed(2) : "0";
  console.log(
    `  ${q.who.padEnd(10)} rtt p50 ${pct(q.rtt, 50)} p95 ${pct(q.rtt, 95)} ms, jitter p95 ${pct(q.jitter, 95)} ms, jitter buffer p50 ${pct(q.jb, 50)} p95 ${pct(q.jb, 95)} ms, ` +
      `audio loss ${loss}%, concealed ${concealed}%, aob p50 ${Math.round((pct(q.aob, 50) ?? 0) / 1000)} kbps, video frames dropped ${q.framesDropped}, freezes ${q.freezes}, PLI ${q.pli}, NACK ${q.nack}`,
  );
}
