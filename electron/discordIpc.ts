/**
 * The Discord Rich Presence socket. Holds `discord-ipc-0` when it is free and
 * answers games itself, so while Gryt has it, games report to Gryt instead of Discord.
 */

import { execFile } from "child_process";
import { existsSync, statSync, unlinkSync } from "fs";
import { link, readdir, readFile, readlink, stat, unlink } from "fs/promises";
import { createServer, type Server, type Socket } from "net";
import { join } from "path";

/* ── Framing ─────────────────────────────────────────────────────────── */

/** Opcode, little-endian int32; length, little-endian int32; then that much JSON. */
export const Op = { Handshake: 0, Frame: 1, Close: 2, Ping: 3, Pong: 4 } as const;

/** An activity is a few hundred bytes. Past this a peer is not a game talking to Discord. */
export const MAX_FRAME_BYTES = 64 * 1024;

export interface IpcFrame {
  op: number;
  body: unknown;
}

export function encodeFrame(op: number, body: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(body), "utf8");
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

/** Frames out of a byte stream that arrives in pieces of any size. Throws on a bad one. */
export class FrameReader {
  private buffered: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): IpcFrame[] {
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk]) : chunk;
    const frames: IpcFrame[] = [];
    while (this.buffered.length >= 8) {
      const op = this.buffered.readInt32LE(0);
      const size = this.buffered.readInt32LE(4);
      if (op < Op.Handshake || op > Op.Pong) throw new Error(`bad opcode ${op}`);
      if (size < 0 || size > MAX_FRAME_BYTES) throw new Error(`bad frame size ${size}`);
      if (this.buffered.length < 8 + size) break;
      const json = this.buffered.subarray(8, 8 + size).toString("utf8");
      this.buffered = this.buffered.subarray(8 + size);
      frames.push({ op, body: JSON.parse(json) as unknown });
    }
    return frames;
  }
}

/* ── Where the socket lives ──────────────────────────────────────────── */

type Env = Record<string, string | undefined>;

/** The folder the discord-rpc libraries look in: the first of these that is set. */
export function ipcDir(env: Env = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "\\\\?\\pipe\\";
  return env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp";
}

export function ipcPath(slot: number, dir: string, platform: NodeJS.Platform = process.platform): string {
  const name = `discord-ipc-${slot}`;
  return platform === "win32" ? `${dir}${name}` : join(dir, name);
}

/* ── Who holds a slot ────────────────────────────────────────────────── */

/** The process listening on a slot. Found without connecting, since Discord takes a connection for a game. */
export interface Holder {
  pid: number | null;
  /** The process name as the OS reports it. */
  name: string;
  /** Discord, or a client built on it. Named plainly in settings, since it's the usual reason. */
  isDiscord: boolean;
}

const DISCORD_FAMILY: ReadonlyArray<[RegExp, string]> = [
  [/^discord ?canary/i, "Discord Canary"],
  [/^discord ?ptb/i, "Discord PTB"],
  [/^discord/i, "Discord"],
  [/^vesktop/i, "Vesktop"],
  [/^armcord/i, "ArmCord"],
  [/^legcord/i, "Legcord"],
];

/** A process name, with a friendly name for the Discord family and the name as it is otherwise. */
export function describeHolder(pid: number | null, raw: string): Holder {
  const base = raw.trim().replace(/\\/g, "/").split("/").pop()?.replace(/\.(exe|app)$/i, "") ?? "";
  for (const [pattern, name] of DISCORD_FAMILY) {
    if (pattern.test(base)) return { pid, name, isDiscord: true };
  }
  return { pid, name: base || "another program", isDiscord: false };
}

type Run = (command: string, args: string[]) => Promise<string>;

const runQuietly: Run = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 4 * 1024 * 1024, timeout: 5_000, windowsHide: true }, (_err, stdout) =>
      resolve(typeof stdout === "string" ? stdout : ""),
    );
  });

/** Names Gryt's own socket can show under: bound at a private name, then linked into place. */
function isSlotName(name: string, path: string): boolean {
  return name === path || name.startsWith(`${path}.gryt-`);
}

/** macOS: lsof lists each Unix socket under the path it was bound at. */
export function parseLsof(output: string, path: string, ownPid: number): Holder | null {
  let pid: number | null = null;
  let command = "";
  for (const line of output.split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      pid = Number(value);
      command = "";
    } else if (tag === "c") {
      command = value;
    } else if (tag === "n" && pid !== null && pid !== ownPid && isSlotName(value, path)) {
      return describeHolder(pid, command);
    }
  }
  return null;
}

/** Linux: the socket's inode from /proc/net/unix, then whichever process has it open. */
async function linuxHolder(path: string, ownPid: number): Promise<Holder | null> {
  const table = await readFile("/proc/net/unix", "utf8").catch(() => "");
  const inodes = new Set<string>();
  for (const line of table.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length >= 8 && isSlotName(cols.slice(7).join(" "), path)) inodes.add(cols[6]);
  }
  if (!inodes.size) return null;
  for (const entry of await readdir("/proc").catch(() => [] as string[])) {
    if (!/^\d+$/.test(entry) || Number(entry) === ownPid) continue;
    const fds = await readdir(`/proc/${entry}/fd`).catch(() => [] as string[]);
    for (const fd of fds) {
      const target = await readlink(`/proc/${entry}/fd/${fd}`).catch(() => "");
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (match && inodes.has(match[1])) {
        const comm = await readFile(`/proc/${entry}/comm`, "utf8").catch(() => "");
        return describeHolder(Number(entry), comm);
      }
    }
  }
  return null;
}

/* Windows can only name a pipe's server from a handle, and opening one is a client
   connection. So this looks for a Discord-family process instead, and says so. */
async function windowsHolder(run: Run): Promise<Holder | null> {
  const out = await run("tasklist.exe", ["/nh", "/fo", "csv"]);
  for (const line of out.split(/\r?\n/)) {
    const [image, pid] = line.split('","').map((part) => part.replace(/^"|"$/g, ""));
    if (!image) continue;
    const holder = describeHolder(Number(pid) || null, image);
    if (holder.isDiscord) return holder;
  }
  return null;
}

/** Who is listening on this slot, or null when nobody is. Never connects to it. */
export async function findHolder(
  path: string,
  platform: NodeJS.Platform = process.platform,
  run: Run = runQuietly,
): Promise<Holder | null> {
  if (platform === "win32") return windowsHolder(run);
  if (platform === "linux") return linuxHolder(path, process.pid);
  return parseLsof(await run("lsof", ["-U", "-F", "pcn"]), path, process.pid);
}

/* ── One connection ──────────────────────────────────────────────────── */

export interface ActivityEvent {
  /** Stable for the life of one connection, so a clear can find what it clears. */
  connection: number;
  /** The Discord application id the game said it is, from the handshake. */
  clientId: string;
  pid?: number;
  /** As the game sent it, unchecked. Null when it cleared it or went away. */
  activity: Record<string, unknown> | null;
}

/** Answers Discord gives that a game may wait for. The user is nobody in particular. */
const READY = {
  cmd: "DISPATCH",
  evt: "READY",
  nonce: null,
  data: {
    v: 1,
    config: { cdn_host: "cdn.discordapp.com", api_endpoint: "//discord.com/api", environment: "production" },
    user: { id: "0", username: "gryt", discriminator: "0", global_name: "Gryt", avatar: null, bot: false, flags: 0, premium_type: 0 },
  },
};

interface ConnectionDeps {
  id: number;
  onActivity: (event: ActivityEvent) => void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function handleConnection(client: Socket, deps: ConnectionDeps): void {
  const reader = new FrameReader();
  let clientId = "";
  let lastPid: number | undefined;
  let hadActivity = false;
  let closed = false;

  const send = (op: number, body: unknown) => {
    if (!client.destroyed) client.write(encodeFrame(op, body));
  };

  const close = (code: number, message: string) => {
    send(Op.Close, { code, message });
    client.end();
  };

  const report = (activity: Record<string, unknown> | null, pid: number | undefined) => {
    if (!clientId) return;
    if (activity === null && !hadActivity) return;
    hadActivity = activity !== null;
    deps.onActivity({ connection: deps.id, clientId, pid, activity });
  };

  const onFrame = (frame: IpcFrame) => {
    const body = asRecord(frame.body);
    if (frame.op === Op.Handshake) {
      if (clientId) return close(1003, "Already shook hands");
      const id = typeof body?.client_id === "string" ? body.client_id : "";
      if (Number(body?.v ?? 1) !== 1) return close(4004, "Invalid version");
      if (!/^\d{1,32}$/.test(id)) return close(4000, "Invalid client id");
      clientId = id;
      send(Op.Frame, READY);
      return;
    }
    if (frame.op === Op.Ping) return send(Op.Pong, frame.body);
    if (frame.op === Op.Close) return void client.end();
    if (frame.op !== Op.Frame || !body) return;
    if (!clientId) return close(1003, "Handshake first");

    const cmd = body.cmd;
    const nonce = body.nonce ?? null;
    const args = asRecord(body.args);
    if (cmd === "SET_ACTIVITY") {
      const pid = typeof args?.pid === "number" ? args.pid : lastPid;
      lastPid = pid;
      const activity = asRecord(args?.activity);
      report(activity, pid);
      send(Op.Frame, {
        cmd,
        evt: null,
        nonce,
        data: activity ? { ...activity, name: "", application_id: clientId, type: 0 } : null,
      });
      return;
    }
    if (cmd === "SUBSCRIBE" || cmd === "UNSUBSCRIBE") {
      send(Op.Frame, { cmd, evt: null, nonce, data: { evt: body.evt ?? null } });
      return;
    }
    send(Op.Frame, { cmd, evt: "ERROR", nonce, data: { code: 4002, message: "Not supported by Gryt" } });
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    client.destroy();
    report(null, lastPid);
  };

  client.on("data", (chunk: Buffer) => {
    let frames: IpcFrame[];
    try {
      frames = reader.push(chunk);
    } catch {
      close(1003, "Bad frame");
      return;
    }
    for (const frame of frames) onFrame(frame);
  });
  client.on("end", finish);
  client.on("close", finish);
  client.on("error", finish);
}

/* ── Holding the slot ────────────────────────────────────────────────── */

export type RpcHostState = "off" | "holding" | "yielded";

export interface RpcHostOptions {
  onActivity: (event: ActivityEvent) => void;
  /** With the holder when yielded, so settings can say who has the slot. */
  onState?: (state: RpcHostState, holder: Holder | null) => void;
  /** Tests point this at a folder of their own. */
  dir?: string;
  platform?: NodeJS.Platform;
  env?: Env;
  /** While something else has slot 0, how often to look again. */
  retryMs?: number;
  /** Tests swap in their own; the real one asks the OS. */
  findHolder?: (path: string) => Promise<Holder | null>;
  /** A game that opens more than this is not a game. */
  maxConnections?: number;
}

export interface RpcHost {
  start(): Promise<RpcHostState>;
  stop(): Promise<void>;
  state(): RpcHostState;
  /** Who has slot 0 while Gryt yields it, when that could be found out. */
  holder(): Holder | null;
}

function listen(server: Server, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = () => resolve(false);
    server.once("error", onError);
    server.listen(path, () => {
      server.off("error", onError);
      resolve(true);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export function createRpcHost(options: RpcHostOptions): RpcHost {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const dir = options.dir ?? ipcDir(env, platform);
  const slot0 = ipcPath(0, dir, platform);
  const retryMs = options.retryMs ?? 3_000;
  const lookUp = options.findHolder ?? ((path: string) => findHolder(path, platform));
  const maxConnections = options.maxConnections ?? 16;

  let current: RpcHostState = "off";
  let holder: Holder | null = null;
  let running = false;
  let server: Server | null = null;
  let ownInode: number | null = null;
  let retry: NodeJS.Timeout | null = null;
  let seq = 0;
  const open = new Set<Socket>();

  const setState = (next: RpcHostState, by: Holder | null = null) => {
    const changed = next !== current || by?.pid !== holder?.pid || by?.name !== holder?.name;
    current = next;
    holder = by;
    if (changed) options.onState?.(next, by);
  };

  /* While the holder is known, checking it is still alive costs nothing. Only when it
     is gone is the slot looked at again, which on macOS spawns lsof. */
  const holderGone = () => {
    if (!holder?.pid) return true;
    try {
      process.kill(holder.pid, 0);
      return false;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ESRCH";
    }
  };

  const onConnection = (socket: Socket) => {
    if (open.size >= maxConnections) {
      socket.destroy();
      return;
    }
    open.add(socket);
    socket.once("close", () => open.delete(socket));
    handleConnection(socket, { id: ++seq, onActivity: options.onActivity });
  };

  /* Only called once nobody holds the slot. Bound under a private name and hard-linked
     into place, since link() won't replace a socket somebody made in the meantime. */
  async function claimUnix(): Promise<Server | null> {
    // Nobody listens on it, so it's what a Discord that quit or crashed left behind.
    if (existsSync(slot0)) await unlink(slot0).catch(() => {});

    const temp = `${slot0}.gryt-${process.pid}`;
    await unlink(temp).catch(() => {});
    const candidate = createServer(onConnection);
    if (!(await listen(candidate, temp))) return null;
    try {
      await link(temp, slot0);
    } catch {
      await closeServer(candidate);
      await unlink(temp).catch(() => {});
      return null;
    }
    await unlink(temp).catch(() => {});
    ownInode = (await stat(slot0)).ino;
    return candidate;
  }

  // A named pipe's first instance is exclusive, so a second listener gets EADDRINUSE.
  async function claimWindows(): Promise<Server | null> {
    const candidate = createServer(onConnection);
    return (await listen(candidate, slot0)) ? candidate : null;
  }

  async function attempt(): Promise<void> {
    if (!running || server) return;
    let found: Holder | null = null;
    let claimed: Server | null = null;
    if (platform === "win32") {
      claimed = await claimWindows();
      if (!claimed) found = await lookUp(slot0).catch(() => null);
    } else {
      found = await lookUp(slot0).catch(() => null);
      if (!found) claimed = await claimUnix();
    }
    if (!running) {
      if (claimed) await release(claimed);
      return;
    }
    if (claimed) {
      // After listening, an error on the server must not take the main process with it.
      claimed.on("error", () => {});
      server = claimed;
      if (retry) clearInterval(retry);
      retry = null;
      setState("holding");
      return;
    }
    setState("yielded", found);
    if (!retry) {
      retry = setInterval(() => {
        if (holderGone()) void attempt();
      }, retryMs);
      retry.unref?.();
    }
  }

  /* Synchronous up to the unlink, so a stop() from will-quit still removes the file. */
  function release(held: Server): Promise<void> {
    // Only our own file. If something replaced it since, that one is not ours to remove.
    if (platform !== "win32" && ownInode !== null) {
      try {
        if (statSync(slot0).ino === ownInode) unlinkSync(slot0);
      } catch {
        /* already gone */
      }
    }
    ownInode = null;
    for (const socket of open) socket.destroy();
    open.clear();
    return closeServer(held);
  }

  return {
    async start() {
      if (running) return current;
      running = true;
      await attempt();
      return current;
    },
    async stop() {
      running = false;
      const held = server;
      server = null;
      if (retry) clearInterval(retry);
      retry = null;
      setState("off");
      if (held) await release(held);
    },
    state: () => current,
    holder: () => holder,
  };
}
