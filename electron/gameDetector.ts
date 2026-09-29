/** Known games spotted by their program, for the ones that don't send Rich Presence (GRYT-1636).
    Asks once per game, and only "this app id is running" ever leaves this module. */

import { readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";

/** Same rule as processWatcher's, here so the checks can load this file on its own. */
export function normaliseExecutable(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  return basename(trimmed).replace(/\.exe$/i, "").toLowerCase();
}

export type Platform = "win32" | "darwin" | "linux";

export interface ExecutablesEntry {
  id: string;
  programs: Partial<Record<Platform, string[]>>;
}

const PLATFORMS: readonly Platform[] = ["win32", "darwin", "linux"];
const MAX_ENTRIES = 50_000;

/** Off the wire or off disk, so anything odd is dropped rather than trusted. */
export function readExecutablesList(value: unknown): ExecutablesEntry[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return [];
  const out: ExecutablesEntry[] = [];
  for (const raw of value) {
    const entry = raw as Record<string, unknown> | null;
    const id = typeof entry?.id === "string" && /^\d{1,32}$/.test(entry.id) ? entry.id : "";
    const programs = entry?.programs as Record<string, unknown> | undefined;
    if (!id || !programs || typeof programs !== "object") continue;
    const parsed: ExecutablesEntry = { id, programs: {} };
    for (const os of PLATFORMS) {
      const list = programs[os];
      if (!Array.isArray(list)) continue;
      const names = list.filter((n): n is string => typeof n === "string" && n.length <= 128).slice(0, 8);
      if (names.length) parsed.programs[os] = names;
    }
    if (Object.keys(parsed.programs).length) out.push(parsed);
  }
  return out;
}

/*
 * Program names too common to mean one game. Plenty of games ship a `game.exe`
 * or `launcher.exe`, and a match on those would ask about the wrong one.
 */
const GENERIC = new Set([
  "game", "launcher", "start", "play", "client", "main", "app", "run", "setup", "install",
  "unity", "ue4", "ue5", "unrealengine", "godot", "java", "javaw", "python", "node", "electron",
  "chrome", "firefox", "msedge", "steam", "steamwebhelper", "update", "updater", "crashreporter",
  "bin", "win64", "win32", "x64", "shipping",
]);

/**
 * Program name to app id for this OS. A name that more than one app claims is
 * dropped: asking about the wrong game is worse than not spotting one.
 */
export function buildProgramIndex(entries: readonly ExecutablesEntry[], platform: Platform): Map<string, string> {
  const owners = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const raw of entry.programs[platform] ?? []) {
      const key = normaliseExecutable(raw);
      if (key.length < 3 || GENERIC.has(key)) continue;
      let ids = owners.get(key);
      if (!ids) owners.set(key, (ids = new Set()));
      ids.add(entry.id);
    }
  }
  const index = new Map<string, string>();
  for (const [key, ids] of owners) if (ids.size === 1) index.set(key, [...ids][0]);
  return index;
}

/** Which known apps are running, in no particular order. */
export function runningApps(running: readonly string[], index: ReadonlyMap<string, string>): string[] {
  const found = new Set<string>();
  for (const raw of running) {
    const id = index.get(normaliseExecutable(raw));
    if (id) found.add(id);
  }
  return [...found];
}

export type Answer = "show" | "hide";

/** Stored answers, off disk. Anything that isn't an app id and an answer is dropped. */
export function readAnswers(value: unknown): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [id, answer] of Object.entries(value as Record<string, unknown>).slice(0, 2000)) {
    if (/^\d{1,32}$/.test(id) && (answer === "show" || answer === "hide")) out[id] = answer;
  }
  return out;
}

export interface GameDetectorOptions {
  list: () => Promise<string[]>;
  index: () => ReadonlyMap<string, string>;
  answers: () => Record<string, Answer>;
  /** A known app with no answer yet. Called on every poll it's seen, so the caller dedupes. */
  onAsk: (appId: string) => void;
  /** App ids to show, with when each was first seen running. Only on change. */
  onChange: (shown: { appId: string; since: number }[]) => void;
  intervalMs?: number;
  now?: () => number;
}

export interface GameDetector {
  /** Once now, then on the interval. */
  start(): void;
  /** Look again at once, after an answer changed. */
  poll(): Promise<void>;
  stop(): void;
}

export function createGameDetector(options: GameDetectorOptions): GameDetector {
  const intervalMs = options.intervalMs ?? 10_000;
  const now = options.now ?? Date.now;
  const since = new Map<string, number>();
  let last = "";
  let timer: NodeJS.Timeout | null = null;
  let polling = false;
  let stopped = false;

  async function poll(): Promise<void> {
    if (polling || stopped) return;
    polling = true;
    try {
      const running = runningApps(await options.list(), options.index());
      const answers = options.answers();
      for (const id of [...since.keys()]) if (!running.includes(id)) since.delete(id);
      const shown: { appId: string; since: number }[] = [];
      for (const id of running) {
        if (!since.has(id)) since.set(id, now());
        const answer = answers[id];
        if (answer === "show") shown.push({ appId: id, since: since.get(id) ?? now() });
        else if (!answer) options.onAsk(id);
      }
      shown.sort((a, b) => a.appId.localeCompare(b.appId));
      const key = JSON.stringify(shown);
      if (key !== last) {
        last = key;
        options.onChange(shown);
      }
    } finally {
      polling = false;
    }
  }

  return {
    start() {
      if (timer || stopped) return;
      void poll();
      timer = setInterval(() => void poll(), intervalMs);
      timer.unref?.();
    },
    poll,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/* ── The program list from Gryt-chat/rich-presence, cached a day ─────── */

const SOURCES = [
  "https://cdn.jsdelivr.net/gh/Gryt-chat/rich-presence@main/executables.json",
  "https://raw.githubusercontent.com/Gryt-chat/rich-presence/main/executables.json",
];
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_ACCEPTABLE = 100;

function cacheFile(userDataDir: string): string {
  return join(userDataDir, "rich-presence-executables.json");
}

/** Only called while detection is on. A failed fetch keeps whatever was cached. */
export async function loadExecutablesList(userDataDir: string, fetchImpl: typeof fetch = fetch): Promise<ExecutablesEntry[]> {
  let cached: { fetchedAt: number; entries: ExecutablesEntry[] } | null = null;
  try {
    const raw = JSON.parse(readFileSync(cacheFile(userDataDir), "utf8")) as Record<string, unknown>;
    const entries = readExecutablesList(raw.entries);
    if (typeof raw.fetchedAt === "number" && entries.length) cached = { fetchedAt: raw.fetchedAt, entries };
  } catch {
    // No cache yet.
  }
  if (cached && Date.now() - cached.fetchedAt < DAY_MS) return cached.entries;

  for (const url of SOURCES) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const entries = readExecutablesList((await res.json()) as unknown);
      if (entries.length < MIN_ACCEPTABLE) continue;
      writeFileSync(cacheFile(userDataDir), JSON.stringify({ fetchedAt: Date.now(), entries }));
      return entries;
    } catch {
      // Next source.
    }
  }
  return cached?.entries ?? [];
}
