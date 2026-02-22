import { gemoji } from "gemoji";

import { getServerHttpBase } from "@/common";

export interface EmojiEntry {
  name: string;
  emoji: string | null;
  isCustom: boolean;
  url?: string;
  tags: string[];
  aliases: string[];
}

export interface EmojiEntryWithCategory extends EmojiEntry {
  category: string;
}

let standardEmojis: EmojiEntry[] | null = null;
let standardEmojisByCategory: Map<string, EmojiEntryWithCategory[]> | null = null;

export function getStandardEmojis(): EmojiEntry[] {
  if (!standardEmojis) {
    standardEmojis = [];
    for (const g of gemoji) {
      for (const name of g.names) {
        standardEmojis.push({
          name,
          emoji: g.emoji,
          isCustom: false,
          tags: g.tags,
          aliases: g.names.filter((n) => n !== name),
        });
      }
    }
  }
  return standardEmojis;
}

export function getStandardEmojisByCategory(): Map<string, EmojiEntryWithCategory[]> {
  if (!standardEmojisByCategory) {
    standardEmojisByCategory = new Map();
    const seen = new Set<string>();
    for (const g of gemoji) {
      if (seen.has(g.emoji)) continue;
      seen.add(g.emoji);
      const entry: EmojiEntryWithCategory = {
        name: g.names[0],
        emoji: g.emoji,
        isCustom: false,
        tags: g.tags,
        aliases: g.names.slice(1),
        category: g.category,
      };
      let list = standardEmojisByCategory.get(g.category);
      if (!list) {
        list = [];
        standardEmojisByCategory.set(g.category, list);
      }
      list.push(entry);
    }
  }
  return standardEmojisByCategory;
}

let customEmojisCache: EmojiEntry[] = [];

export function getCustomEmojiUrl(serverHost: string, name: string): string {
  return `${getServerHttpBase(serverHost)}/api/emojis/img/${encodeURIComponent(name)}`;
}

export function setCustomEmojis(emojis: { name: string; file_id: string }[], serverHost: string): void {
  customEmojisCache = emojis.map((e) => ({
    name: e.name,
    emoji: null,
    isCustom: true,
    url: getCustomEmojiUrl(serverHost, e.name),
    tags: [],
    aliases: [],
  }));
}

export function getCustomEmojis(): EmojiEntry[] {
  return customEmojisCache;
}

export function getAllEmojis(): EmojiEntry[] {
  return [...getStandardEmojis(), ...customEmojisCache];
}

const enum MatchTier {
  ExactPrefix = 0,
  WordBoundary = 1,
  Substring = 2,
  TagOrAlias = 3,
}

interface ScoredEntry {
  entry: EmojiEntry;
  tier: MatchTier;
}

export function searchEmojis(query: string, limit = 0): EmojiEntry[] {
  if (!query) return [];
  const q = query.toLowerCase();
  const all = getAllEmojis();
  const scored: ScoredEntry[] = [];

  for (const entry of all) {
    const name = entry.name.toLowerCase();

    if (name.startsWith(q)) {
      scored.push({ entry, tier: MatchTier.ExactPrefix });
      continue;
    }

    const parts = name.split(/[_-]/);
    if (parts.some((p) => p.startsWith(q))) {
      scored.push({ entry, tier: MatchTier.WordBoundary });
      continue;
    }

    if (name.includes(q)) {
      scored.push({ entry, tier: MatchTier.Substring });
      continue;
    }

    const matchesTag = entry.tags.some((t) => t.toLowerCase().startsWith(q));
    const matchesAlias = entry.aliases.some((a) => a.toLowerCase().startsWith(q));
    if (matchesTag || matchesAlias) {
      scored.push({ entry, tier: MatchTier.TagOrAlias });
    }
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.entry.isCustom !== b.entry.isCustom) return a.entry.isCustom ? -1 : 1;
    return a.entry.name.localeCompare(b.entry.name);
  });

  const seen = new Set<string>();
  const results: EmojiEntry[] = [];
  for (const s of scored) {
    const key = s.entry.isCustom ? `custom:${s.entry.name}` : s.entry.name;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(s.entry);
    if (limit > 0 && results.length >= limit) break;
  }

  return results;
}

const RECENT_KEY = "gryt:recentEmojis";
const MAX_RECENT = 30;
const DEFAULT_RECENT = ["thumbsup", "heart", "joy", "open_mouth", "cry", "thumbsdown", "fire", "100"];

interface StoredRecent {
  name: string;
  custom: boolean;
}

function readRecentStorage(): StoredRecent[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return [];
}

function writeRecentStorage(list: StoredRecent[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* storage full */ }
}

export function recordRecentEmoji(name: string, isCustom: boolean): void {
  const stored = readRecentStorage();
  const entry: StoredRecent = { name, custom: isCustom };
  const updated = [entry, ...stored.filter((s) => !(s.name === name && s.custom === isCustom))].slice(0, MAX_RECENT);
  writeRecentStorage(updated);
}

export function getRecentEmojis(limit = 8): EmojiEntry[] {
  const stored = readRecentStorage();
  const all = getAllEmojis();
  const byKey = new Map<string, EmojiEntry>();
  for (const e of all) {
    byKey.set(e.isCustom ? `custom:${e.name}` : e.name, e);
  }

  const results: EmojiEntry[] = [];
  for (const s of stored) {
    const key = s.custom ? `custom:${s.name}` : s.name;
    const entry = byKey.get(key);
    if (entry) {
      results.push(entry);
      if (results.length >= limit) return results;
    }
  }

  for (const fallback of DEFAULT_RECENT) {
    if (results.length >= limit) break;
    const entry = byKey.get(fallback);
    if (entry && !results.some((r) => r.name === fallback && !r.isCustom)) {
      results.push(entry);
    }
  }

  return results.slice(0, limit);
}

export async function fetchCustomEmojis(serverHost: string): Promise<{ name: string; file_id: string }[]> {
  const base = getServerHttpBase(serverHost);
  console.log("[EmojiData] fetchCustomEmojis:", { serverHost, url: `${base}/api/emojis` });
  try {
    const res = await fetch(`${base}/api/emojis`);
    console.log("[EmojiData] fetchCustomEmojis response:", { status: res.status, ok: res.ok });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[EmojiData] fetchCustomEmojis failed:", { status: res.status, body: text });
      return [];
    }
    const data = await res.json();
    console.log("[EmojiData] fetchCustomEmojis got", data.length, "emojis");
    return data;
  } catch (err) {
    console.error("[EmojiData] fetchCustomEmojis error:", err);
    return [];
  }
}
