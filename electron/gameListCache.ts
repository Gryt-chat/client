/**
 * The game list at github.com/Gryt-chat/rich-presence (`games.json`), fetched so a game
 * outside our curated list still gets a real name, and so detection knows program names.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export type GameOs = "win32" | "darwin" | "linux";

export interface ListedGame {
  id: string;
  name: string;
  /** Program names per system, for spotting the game running (GRYT-1636). */
  programs?: Partial<Record<GameOs, string[]>>;
}

/** Past this, a response is not the game list any more, whatever else it looks like. */
const MAX_ENTRIES = 50_000;
const OSES: readonly GameOs[] = ["win32", "darwin", "linux"];

/** `games.json`'s `{ games: [...] }`, or a bare array. A bad entry is one game missing, not a crash. */
export function readGamesFile(value: unknown): ListedGame[] {
  const list = Array.isArray(value) ? value : (value as { games?: unknown } | null)?.games;
  if (!Array.isArray(list) || list.length > MAX_ENTRIES) return [];
  const out: ListedGame[] = [];
  for (const raw of list) {
    const entry = raw as Record<string, unknown> | null;
    const id = typeof entry?.id === "string" && /^\d{1,32}$/.test(entry.id) ? entry.id : "";
    const name = typeof entry?.name === "string" ? entry.name.trim().slice(0, 64) : "";
    if (!id || !name) continue;
    const parsed: ListedGame = { id, name };
    const programs = entry?.programs as Record<string, unknown> | undefined;
    if (programs && typeof programs === "object") {
      for (const os of OSES) {
        const names = programs[os];
        if (!Array.isArray(names)) continue;
        const clean = names.filter((n): n is string => typeof n === "string" && n.length > 0 && n.length <= 128).slice(0, 8);
        if (clean.length) (parsed.programs ??= {})[os] = clean;
      }
    }
    out.push(parsed);
  }
  return out;
}

export function createGameLookup(entries: readonly ListedGame[]): Map<string, ListedGame> {
  const byId = new Map<string, ListedGame>();
  for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  return byId;
}

export interface NameSources {
  /** `games.json`, curated by us: always wins when it has an answer. */
  overrides: (appId: string) => string | null;
  /** What the last successful fetch from the repo found. */
  downloaded: ReadonlyMap<string, ListedGame>;
  /** Shipped with this build, for when nothing has been fetched yet. */
  bundled: ReadonlyMap<string, ListedGame>;
}

/** overrides -> downloaded -> bundled -> unknown. */
export function resolveGameName(sources: NameSources, appId: string): string | null {
  return (
    sources.overrides(appId) ??
    sources.downloaded.get(appId)?.name ??
    sources.bundled.get(appId)?.name ??
    null
  );
}

/* ── The on-disk cache ───────────────────────────────────────────────── */

interface CacheFile {
  fetchedAt: number;
  entries: ListedGame[];
}

function cachePath(userDataDir: string): string {
  return join(userDataDir, "rich-presence-games.json");
}

export function readCache(userDataDir: string): CacheFile | null {
  try {
    const raw = JSON.parse(readFileSync(cachePath(userDataDir), "utf8")) as Record<string, unknown>;
    const fetchedAt = typeof raw.fetchedAt === "number" && Number.isFinite(raw.fetchedAt) ? raw.fetchedAt : 0;
    const entries = readGamesFile(raw.entries);
    if (!fetchedAt || !entries.length) return null;
    return { fetchedAt, entries };
  } catch {
    return null;
  }
}

export function writeCache(userDataDir: string, entries: readonly ListedGame[]): void {
  const file: CacheFile = { fetchedAt: Date.now(), entries: [...entries] };
  writeFileSync(cachePath(userDataDir), JSON.stringify(file));
}

export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function isStale(cache: CacheFile | null, now: number): boolean {
  return !cache || now - cache.fetchedAt >= REFRESH_INTERVAL_MS;
}

/* ── Fetching ────────────────────────────────────────────────────────── */

/** GitHub first: jsdelivr can serve a `@main` file a day old, which hid newly added games. */
const SOURCES = [
  "https://raw.githubusercontent.com/Gryt-chat/rich-presence/main/games.json",
  "https://cdn.jsdelivr.net/gh/Gryt-chat/rich-presence@main/games.json",
];

/** Fewer entries than this reads as a broken fetch, not as the list shrinking. */
const MIN_ACCEPTABLE_ENTRIES = 100;

export async function fetchGamesFile(
  fetchImpl: typeof fetch,
  sources: readonly string[] = SOURCES,
): Promise<ListedGame[] | null> {
  for (const url of sources) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const body = (await res.json()) as unknown;
      const entries = readGamesFile(body);
      if (entries.length >= MIN_ACCEPTABLE_ENTRIES) return entries;
    } catch {
      // Try the next source. Both failing is handled by the caller.
    }
  }
  return null;
}

export interface RefreshDeps {
  userDataDir: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Refetches only when the cache is missing or a day old. A bad fetch just logs and keeps the old cache. */
export async function maybeRefreshGames(deps: RefreshDeps): Promise<Map<string, ListedGame>> {
  const now = deps.now ?? Date.now;
  const cache = readCache(deps.userDataDir);
  if (!isStale(cache, now())) return createGameLookup(cache?.entries ?? []);

  const fresh = await fetchGamesFile(deps.fetchImpl ?? fetch);
  if (!fresh) {
    console.error(
      cache
        ? "rich presence: couldn't refresh the game list, keeping the cached one"
        : "rich presence: couldn't fetch the game list and there's no cache yet",
    );
    return createGameLookup(cache?.entries ?? []);
  }

  writeCache(deps.userDataDir, fresh);
  return createGameLookup(fresh);
}
