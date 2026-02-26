const STORAGE_PREFIX = "gryt:recentReactions";
const MAX_STORED = 30;
const DEFAULT_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "👎"];

function storageKey(serverHost: string | undefined): string {
  return serverHost ? `${STORAGE_PREFIX}:${serverHost}` : STORAGE_PREFIX;
}

function readStorage(serverHost: string | undefined): string[] {
  try {
    const raw = localStorage.getItem(storageKey(serverHost));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed;
  } catch { /* ignore corrupt data */ }
  return [];
}

function writeStorage(serverHost: string | undefined, list: string[]): void {
  try {
    localStorage.setItem(storageKey(serverHost), JSON.stringify(list));
  } catch { /* storage full or unavailable */ }
}

export function getRecentReactions(count = 6, serverHost?: string): string[] {
  const stored = readStorage(serverHost);
  if (stored.length >= count) return stored.slice(0, count);
  const filler = DEFAULT_REACTIONS.filter((d) => !stored.includes(d));
  return [...stored, ...filler].slice(0, count);
}

export function recordReaction(src: string, serverHost?: string): void {
  const stored = readStorage(serverHost);
  const updated = [src, ...stored.filter((s) => s !== src)].slice(0, MAX_STORED);
  writeStorage(serverHost, updated);
}
