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

export function searchEmojis(query: string, limit = 8): EmojiEntry[] {
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
    if (results.length >= limit) break;
  }

  return results;
}

export async function fetchCustomEmojis(serverHost: string): Promise<{ name: string; file_id: string }[]> {
  try {
    const base = getServerHttpBase(serverHost);
    const res = await fetch(`${base}/api/emojis`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}
