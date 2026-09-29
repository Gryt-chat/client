/**
 * The bigger list of Discord-detectable games, mirrored at
 * https://github.com/Gryt-chat/rich-presence and fetched by the client so a
 * game outside our curated `games.json` still gets a real name. `games.json`
 * (read by `gameList.ts`) always wins; this only fills in names it doesn't have.
 *
 * Only ids and names come from here. Icons are mirrored in that repo too, but
 * nothing in the client loads or shows one yet: Rich Presence cards are text
 * only, on purpose (client#726), and wiring images through is GRYT-1602.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface DetectableEntry {
  id: string;
  name: string;
  icon_hash?: string;
}

/** Past this, a response is not Discord's list any more, whatever else it looks like. */
const MAX_ENTRIES = 50_000;

/** Off the wire or off disk, so a bad file or a bad response is an empty list, not a crash. */
export function readDetectableList(value: unknown): DetectableEntry[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return [];
  const out: DetectableEntry[] = [];
  for (const raw of value) {
    const entry = raw as Record<string, unknown> | null;
    const id = typeof entry?.id === "string" && /^\d{1,32}$/.test(entry.id) ? entry.id : "";
    const name = typeof entry?.name === "string" ? entry.name.trim().slice(0, 64) : "";
    if (!id || !name) continue;
    const parsed: DetectableEntry = { id, name };
    if (typeof entry?.icon_hash === "string" && entry.icon_hash) parsed.icon_hash = entry.icon_hash;
    out.push(parsed);
  }
  return out;
}

export function createDetectableIndex(entries: readonly DetectableEntry[]): Map<string, DetectableEntry> {
  const byId = new Map<string, DetectableEntry>();
  for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  return byId;
}

export interface NameSources {
  /** `games.json`, curated by us: always wins when it has an answer. */
  overrides: (appId: string) => string | null;
  /** What the last successful fetch from the repo found. */
  downloaded: ReadonlyMap<string, DetectableEntry>;
  /** Shipped with this build, for when nothing has been fetched yet. */
  bundled: ReadonlyMap<string, DetectableEntry>;
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
  entries: DetectableEntry[];
}

function cachePath(userDataDir: string): string {
  return join(userDataDir, "rich-presence-games.json");
}

export function readCache(userDataDir: string): CacheFile | null {
  try {
    const raw = JSON.parse(readFileSync(cachePath(userDataDir), "utf8")) as Record<string, unknown>;
    const fetchedAt = typeof raw.fetchedAt === "number" && Number.isFinite(raw.fetchedAt) ? raw.fetchedAt : 0;
    const entries = readDetectableList(raw.entries);
    if (!fetchedAt || !entries.length) return null;
    return { fetchedAt, entries };
  } catch {
    return null;
  }
}

export function writeCache(userDataDir: string, entries: readonly DetectableEntry[]): void {
  const file: CacheFile = { fetchedAt: Date.now(), entries: [...entries] };
  writeFileSync(cachePath(userDataDir), JSON.stringify(file));
}

export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function isStale(cache: CacheFile | null, now: number): boolean {
  return !cache || now - cache.fetchedAt >= REFRESH_INTERVAL_MS;
}

/* ── Fetching ────────────────────────────────────────────────────────── */

/** jsdelivr first: it's a CDN in front of the repo. raw.githubusercontent.com is the fallback. */
const SOURCES = [
  "https://cdn.jsdelivr.net/gh/Gryt-chat/rich-presence@main/detectable.json",
  "https://raw.githubusercontent.com/Gryt-chat/rich-presence/main/detectable.json",
];

/** Fewer entries than this reads as a broken fetch, not as Discord's list shrinking. */
const MIN_ACCEPTABLE_ENTRIES = 100;

export async function fetchDetectableList(
  fetchImpl: typeof fetch,
  sources: readonly string[] = SOURCES,
): Promise<DetectableEntry[] | null> {
  for (const url of sources) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const body = (await res.json()) as unknown;
      const entries = readDetectableList(body);
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

/**
 * Refetches only when the cache is missing or a day old. Any failure along the
 * way - no network, a bad body, too few entries - leaves the existing cache
 * alone and just logs it, since a broken fetch should never mean losing names
 * the last good fetch already had.
 */
export async function maybeRefreshDetectableList(deps: RefreshDeps): Promise<Map<string, DetectableEntry>> {
  const now = deps.now ?? Date.now;
  const cache = readCache(deps.userDataDir);
  if (!isStale(cache, now())) return createDetectableIndex(cache?.entries ?? []);

  const fresh = await fetchDetectableList(deps.fetchImpl ?? fetch);
  if (!fresh) {
    console.error(
      cache
        ? "rich presence: couldn't refresh the game list, keeping the cached one"
        : "rich presence: couldn't fetch the game list and there's no cache yet",
    );
    return createDetectableIndex(cache?.entries ?? []);
  }

  writeCache(deps.userDataDir, fresh);
  return createDetectableIndex(fresh);
}
