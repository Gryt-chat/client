/**
 * The app's end of gryt-helper's private channel (GRYT-1605): where it is, and what it says.
 * The same file ships in the opt-in PR, so the two merge cleanly in either order.
 */

import { createHash } from "crypto";
import { lstatSync } from "fs";
import { createConnection, type Socket } from "net";
import { homedir } from "os";
import { dirname, join } from "path";

import type { ActivityEvent } from "./discordIpc";

type Env = Record<string, string | undefined>;

/** Kept in step with privatePath() in helper/private_unix.go and helper/private_windows.go. */
export function helperPath(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    const account = `${env.USERDOMAIN ?? ""}\\${env.USERNAME ?? ""}`.toLowerCase();
    const hash = createHash("sha256").update(account).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\gryt-helper-${hash}`;
  }
  if (platform === "darwin") return join(home, "Library", "Application Support", "chat.gryt.helper", "helper.sock");
  if (env.XDG_RUNTIME_DIR) return join(env.XDG_RUNTIME_DIR, "gryt-helper", "helper.sock");
  return join(home, ".cache", "gryt-helper", "helper.sock");
}

/** Only a folder this user owns and nobody else can enter, so nobody else can have put a socket there. */
export function isPrivateDir(dir: string, uid: number | undefined = process.getuid?.()): boolean {
  try {
    const info = lstatSync(dir);
    return info.isDirectory() && info.uid === uid && (info.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

export interface HelperStatus {
  state: "holding" | "yielded";
  slot: number | null;
}

/** One line of the helper's protocol, checked, or null for anything else. */
export function parseHelperLine(line: string): ({ type: "hello" | "state" } & HelperStatus) | ({ type: "activity" } & ActivityEvent) | null {
  let msg: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    msg = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (msg.type === "hello" || msg.type === "state") {
    if (msg.type === "hello" && msg.version !== 1) return null;
    const holding = msg.state === "holding" && typeof msg.slot === "number" && Number.isInteger(msg.slot);
    return { type: msg.type, state: holding ? "holding" : "yielded", slot: holding ? (msg.slot as number) : null };
  }
  if (msg.type === "activity") {
    if (typeof msg.connection !== "number" || typeof msg.clientId !== "string" || !/^\d{1,32}$/.test(msg.clientId)) return null;
    const activity = msg.activity;
    const record = typeof activity === "object" && activity !== null && !Array.isArray(activity) ? (activity as Record<string, unknown>) : null;
    return {
      type: "activity",
      connection: msg.connection,
      clientId: msg.clientId,
      pid: typeof msg.pid === "number" ? msg.pid : undefined,
      activity: record,
    };
  }
  return null;
}

export interface HelperLink {
  status(): HelperStatus;
  /** Stops the helper. It removes its socket on the way out. */
  quit(): void;
  close(): void;
}

export interface ConnectOptions {
  path?: string;
  platform?: NodeJS.Platform;
  onActivity: (event: ActivityEvent) => void;
  onStatus: (status: HelperStatus) => void;
  onClose: () => void;
  helloTimeoutMs?: number;
}

/** A frame is capped at 64 KB, so a line past this isn't the helper. */
const MAX_LINE = 96 * 1024;

/** Resolves once the helper says hello, or null when it isn't running. */
export function connectHelper(options: ConnectOptions): Promise<HelperLink | null> {
  const platform = options.platform ?? process.platform;
  const path = options.path ?? helperPath(platform);
  if (platform !== "win32" && !isPrivateDir(dirname(path))) return Promise.resolve(null);

  return new Promise((resolve) => {
    let status: HelperStatus | null = null;
    let buffered = "";
    let settled = false;
    let closed = false;
    const socket: Socket = createConnection(path);

    const settle = (link: HelperLink | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!link) socket.destroy();
      resolve(link);
    };
    const timer = setTimeout(() => settle(null), options.helloTimeoutMs ?? 1_000);

    const link: HelperLink = {
      status: () => status ?? { state: "yielded", slot: null },
      quit: () => {
        if (!socket.destroyed) socket.end('{"type":"quit"}\n');
      },
      close: () => socket.destroy(),
    };

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffered += chunk;
      if (buffered.length > MAX_LINE && !buffered.includes("\n")) return void socket.destroy();
      let end: number;
      while ((end = buffered.indexOf("\n")) !== -1) {
        const msg = parseHelperLine(buffered.slice(0, end));
        buffered = buffered.slice(end + 1);
        if (!msg) continue;
        if (msg.type === "activity") {
          if (status) options.onActivity(msg);
          continue;
        }
        status = { state: msg.state, slot: msg.slot };
        if (msg.type === "hello") settle(link);
        options.onStatus(status);
      }
    });
    socket.on("error", () => settle(null));
    socket.on("close", () => {
      settle(null);
      if (closed || !status) return;
      closed = true;
      options.onClose();
    });
  });
}
