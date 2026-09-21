import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { networkInterfaces } from "node:os";

import { io, type Socket } from "socket.io-client";

import type { EventWriter } from "./jsonl";

export interface Stoppable {
  stop(): void;
}

/**
 * A bare socket.io connection from Node, joined to nothing. It sees the same path as the app's
 * socket, without Chromium, so a drop here and in the browsers at once is the path.
 */
export function socketProbe(log: EventWriter, url: string): Stoppable {
  const socket: Socket = io(url, { transports: ["websocket"], reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
  const state = { id: null as string | null, connectedAt: 0, droppedAt: 0, lastPingAt: 0 };
  socket.io.on("ping", () => {
    state.lastPingAt = Date.now();
  });
  socket.on("connect", () => {
    state.id = socket.id ?? null;
    state.connectedAt = Date.now();
    const downMs = state.droppedAt ? state.connectedAt - state.droppedAt : null;
    log.write("sio.connect", { uri: url, id: state.id, downMs });
  });
  socket.on("disconnect", (reason, details) => {
    state.droppedAt = Date.now();
    const context = (details as { context?: { code?: number; reason?: string; wasClean?: boolean } } | undefined)?.context;
    log.write("sio.disconnect", {
      uri: url,
      id: state.id,
      reason,
      details: details && {
        description: String((details as { description?: unknown }).description ?? ""),
        code: context?.code,
        closeReason: context?.reason,
      },
      upMs: state.connectedAt ? state.droppedAt - state.connectedAt : null,
      lastPingAgoMs: state.lastPingAt ? state.droppedAt - state.lastPingAt : null,
    });
  });
  socket.on("connect_error", (err) => log.write("sio.connect_error", { uri: url, error: err.message }));
  socket.io.on("reconnect_attempt", (attempt) => log.write("sio.reconnect_attempt", { uri: url, attempt }));
  return { stop: () => socket.disconnect() };
}

/**
 * A raw WebSocket to the SFU's client path that never joins. The SFU pings it every 30 seconds and
 * Node answers, so it stays up until something between here and the SFU ends it.
 */
export function sfuProbe(log: EventWriter, base: string): Stoppable {
  const url = `${base.replace(/\/$/, "")}/client`;
  let ws: WebSocket | null = null;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let droppedAt = 0;

  const open = () => {
    const started = Date.now();
    let openedAt = 0;
    const socket = new WebSocket(url);
    ws = socket;
    socket.addEventListener("open", () => {
      openedAt = Date.now();
      const downMs = droppedAt ? openedAt - droppedAt : null;
      log.write("ws.open", { url, ms: openedAt - started, downMs });
    });
    socket.addEventListener("error", () => log.write("ws.error", { url }));
    socket.addEventListener("close", (e) => {
      const now = Date.now();
      if (openedAt) droppedAt = now;
      log.write("ws.close", { url, code: e.code, reason: e.reason, wasClean: e.wasClean, upMs: openedAt ? now - openedAt : null });
      if (!stopped) retry = setTimeout(open, 2000);
    });
  };
  open();
  return {
    stop: () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    },
  };
}

/** GET /health every `everyMs`, so a gap in the sockets can be matched to a gap in plain requests. */
export function httpProbe(log: EventWriter, base: string, everyMs = 10_000): Stoppable {
  const url = `${base.replace(/\/$/, "")}/health`;
  const tick = async () => {
    const started = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
      await res.arrayBuffer();
      log.write("http", { url, status: res.status, ms: Date.now() - started, ray: res.headers.get("cf-ray") ?? undefined });
    } catch (err) {
      // fetch says only "fetch failed". The code underneath tells a refusal from an unreachable host.
      const cause = (err as { cause?: { code?: string } }).cause?.code;
      log.write("http", { url, error: (err as Error).message, cause, ms: Date.now() - started });
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  void tick();
  return { stop: () => clearInterval(timer) };
}

/** `ping` every two seconds: a timeout is logged when it happens, the round trips once a minute. */
export function pingProbe(log: EventWriter, host: string): Stoppable {
  const child: ChildProcess = spawn("ping", ["-i", "2", host], { stdio: ["ignore", "pipe", "ignore"] });
  // An interrupted run skips the test's cleanup, and ping would outlive it.
  const reap = () => child.kill();
  process.once("exit", reap);
  let times: number[] = [];
  let lost = 0;
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const rtt = /time=([\d.]+) ms/.exec(line);
      if (rtt) times.push(Number(rtt[1]));
      else if (/timeout|unreachable|No route|down/i.test(line)) {
        lost++;
        log.write("ping.lost", { host, line: line.trim() });
      }
    }
  });
  const timer = setInterval(() => {
    const sorted = [...times].sort((a, b) => a - b);
    const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
    log.write("ping", { host, replies: sorted.length, lost, min: sorted[0], avg: avg && Math.round(avg * 10) / 10, max: sorted.at(-1) });
    times = [];
    lost = 0;
  }, 60_000);
  return {
    stop: () => {
      clearInterval(timer);
      process.removeListener("exit", reap);
      child.kill();
    },
  };
}

/** This machine's addresses every five seconds. Hashed, because the files should not carry them. */
export function networkWatch(log: EventWriter, everyMs = 5000): Stoppable {
  const snapshot = () => {
    const seen = new Map<string, string>();
    for (const [name, list] of Object.entries(networkInterfaces())) {
      for (const a of list ?? []) {
        if (a.internal) continue;
        const scope = a.family === "IPv6" ? (a.address.startsWith("fe80") ? "link" : "global") : "v4";
        const id = createHash("sha256").update(a.address).digest("hex").slice(0, 8);
        seen.set(`${name}/${scope}/${id}`, a.family);
      }
    }
    return seen;
  };
  let last = snapshot();
  log.write("net.snapshot", { addresses: [...last.keys()] });
  const timer = setInterval(() => {
    const now = snapshot();
    const added = [...now.keys()].filter((k) => !last.has(k));
    const removed = [...last.keys()].filter((k) => !now.has(k));
    if (added.length || removed.length) log.write("net.change", { added, removed });
    last = now;
  }, everyMs);
  return { stop: () => clearInterval(timer) };
}

/** Which interface carries the default route for one family, or null when there isn't one. */
function defaultRoute(family: "v4" | "v6"): Promise<string | null> {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["route", ["-n", "get", ...(family === "v6" ? ["-inet6"] : []), "default"]]
      : ["ip", [family === "v6" ? "-6" : "-4", "route", "show", "default"]];
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(null);
      const iface = /interface:\s*(\S+)/.exec(stdout)?.[1] ?? / dev (\S+)/.exec(stdout)?.[1];
      resolve(iface ?? null);
    });
  });
}

/**
 * The default route for IPv4 and IPv6 every `everyMs`, logged when it comes or goes. A router withdrawing
 * its IPv6 route kills every IPv6 connection from the house at once, which looked like Gryt dropping (GRYT-1357).
 */
export function routeWatch(log: EventWriter, everyMs = 2000): Stoppable {
  const last: Record<string, string | null | undefined> = {};
  const check = async () => {
    for (const family of ["v4", "v6"] as const) {
      const iface = await defaultRoute(family);
      if (last[family] !== undefined && last[family] !== iface) log.write("net.route", { family, iface, was: last[family] });
      last[family] = iface;
    }
  };
  void check().then(() => log.write("net.route_snapshot", { v4: last.v4, v6: last.v6 }));
  const timer = setInterval(() => void check(), everyMs);
  return { stop: () => clearInterval(timer) };
}
