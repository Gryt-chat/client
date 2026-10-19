/** Known games spotted by their program, for the ones that don't send Rich Presence (GRYT-1636).
    Asks once per game, and only "this app id is running" ever leaves this module. */

import { basename } from "path";

/** Same rule as processWatcher's, here so the checks can load this file on its own. */
export function normaliseExecutable(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  return basename(trimmed).replace(/\.exe$/i, "").toLowerCase();
}

export type Platform = "win32" | "darwin" | "linux";

/** A listed game's program names; the game list's entries fit this. */
export interface ExecutablesEntry {
  id: string;
  programs?: Partial<Record<Platform, string[]>>;
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

/** What a detected key is: its name, whether it's an app, and the Rich Presence ids that stand for it. */
export interface KnownApp {
  name: string | null;
  kind: "game" | "app";
  /** Ids a game or a plugin for the app sends over Rich Presence. While one reports, this isn't asked about or shown. */
  rpcIds: string[];
}

/** A key for something with no Discord id of its own, like Figma: `app:figma`. */
export function appKey(name: string): string {
  return `app:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
}

const KEY = /^(\d{1,32}|app:[a-z0-9-]{1,40})$/;

/** Windows games run under Proton on Linux keep their Windows names, and Linux cuts names to fifteen characters. */
function osesFor(platform: Platform): Platform[] {
  return platform === "linux" ? ["linux", "win32"] : [platform];
}

function keysForName(raw: string, platform: Platform): string[] {
  const key = normaliseExecutable(raw);
  if (key.length < 3 || GENERIC.has(key)) return [];
  const out = [key];
  if (platform === "linux" && key.length > 15) out.push(key.slice(0, 15));
  return out;
}

export interface ProgramIndex {
  byProgram: Map<string, string>;
  known: Map<string, KnownApp>;
}

export interface CuratedEntry {
  name: string;
  ids: string[];
  exe: Partial<Record<Platform, string[]>>;
  kind?: "game" | "app";
}

/**
 * Program name to key for this OS. Our curated list wins over Discord's, and a
 * name two entries of the same list claim is dropped rather than guessed.
 */
export function buildProgramIndex(
  entries: readonly ExecutablesEntry[],
  platform: Platform,
  curated: readonly CuratedEntry[] = [],
): ProgramIndex {
  const known = new Map<string, KnownApp>();
  const claim = (owners: Map<string, Set<string>>, raw: string, key: string) => {
    for (const name of keysForName(raw, platform)) {
      let ids = owners.get(name);
      if (!ids) owners.set(name, (ids = new Set()));
      ids.add(key);
    }
  };

  const ours = new Map<string, Set<string>>();
  for (const entry of curated) {
    const key = entry.ids[0] ?? appKey(entry.name);
    if (!KEY.test(key)) continue;
    known.set(key, { name: entry.name, kind: entry.kind ?? "game", rpcIds: [...entry.ids] });
    for (const os of osesFor(platform)) for (const raw of entry.exe[os] ?? []) claim(ours, raw, key);
  }

  const theirs = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const os of osesFor(platform)) for (const raw of entry.programs?.[os] ?? []) claim(theirs, raw, entry.id);
  }

  const byProgram = new Map<string, string>();
  for (const [name, ids] of theirs) {
    if (ids.size !== 1) continue;
    const id = [...ids][0];
    byProgram.set(name, id);
    if (!known.has(id)) known.set(id, { name: null, kind: "game", rpcIds: [id] });
  }
  for (const [name, ids] of ours) {
    if (ids.size === 1) byProgram.set(name, [...ids][0]);
    else byProgram.delete(name);
  }
  return { byProgram, known };
}

/** What a running process could be called: its file, and on macOS the `.app` it sits in. */
function runningKeys(raw: string, platform: Platform): string[] {
  const path = raw.trim().replace(/\\/g, "/");
  const keys = [normaliseExecutable(path)];
  if (platform === "darwin") {
    for (const segment of path.split("/")) if (segment.toLowerCase().endsWith(".app")) keys.push(segment.toLowerCase());
  }
  return keys.filter(Boolean);
}

/** Which known keys are running, in no particular order. */
export function runningApps(running: readonly string[], index: ReadonlyMap<string, string>, platform: Platform = "win32"): string[] {
  const found = new Set<string>();
  for (const raw of running) {
    for (const key of runningKeys(raw, platform)) {
      const id = index.get(key);
      if (id) found.add(id);
    }
  }
  return [...found];
}

export type Answer = "show" | "hide";

/** Stored answers, off disk. Anything that isn't an app id and an answer is dropped. */
export function readAnswers(value: unknown): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [id, answer] of Object.entries(value as Record<string, unknown>).slice(0, 2000)) {
    if (KEY.test(id) && (answer === "show" || answer === "hide")) out[id] = answer;
  }
  return out;
}

export interface GameDetectorOptions {
  list: () => Promise<string[]>;
  index: () => ReadonlyMap<string, string>;
  answers: () => Record<string, Answer>;
  /** Keys whose game or plugin is reporting over Rich Presence right now: not asked about, not shown. */
  reporting?: () => ReadonlySet<string>;
  platform?: Platform;
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
      const running = runningApps(await options.list(), options.index(), options.platform);
      const answers = options.answers();
      const reporting = options.reporting?.() ?? new Set<string>();
      for (const id of [...since.keys()]) if (!running.includes(id)) since.delete(id);
      const shown: { appId: string; since: number }[] = [];
      for (const id of running) {
        if (!since.has(id)) since.set(id, now());
        if (reporting.has(id)) continue;
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
