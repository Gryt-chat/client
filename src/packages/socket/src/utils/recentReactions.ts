const STORAGE_KEY = "gryt:recentReactions";
const MAX_STORED = 30;
const DEFAULT_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "👎"];

function readStorage(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed;
  } catch { /* ignore corrupt data */ }
  return [];
}

function writeStorage(list: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { /* storage full or unavailable */ }
}

export function getRecentReactions(count = 6): string[] {
  const stored = readStorage();
  if (stored.length === 0) return DEFAULT_REACTIONS.slice(0, count);
  return stored.slice(0, count);
}

export function recordReaction(src: string): void {
  const stored = readStorage();
  const updated = [src, ...stored.filter((s) => s !== src)].slice(0, MAX_STORED);
  writeStorage(updated);
}
