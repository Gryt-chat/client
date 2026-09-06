const STORAGE_PREFIX = "gryt:recentReactions";
const MAX_STORED = 30;
const DEFAULT_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "👎"];

/**
 * One reaction somebody has used, carrying enough to answer either question.
 *
 * `count` answers "what do I reach for most", which is what the hover toolbar
 * wants: a bar that reshuffles after one stray reaction is a bar whose buttons
 * move out from under the pointer. `usedAt` answers "what did I just use",
 * which is what the picker's recents row wants.
 *
 * Per device, and it stays that way. This is a record of what somebody finds
 * funny, the server has no use for it, and it is keyed per host so a work
 * server and a group of friends do not share one row.
 */
interface ReactionUse {
  src: string;
  count: number;
  usedAt: number;
}

function storageKey(serverHost: string | undefined): string {
  return serverHost ? `${STORAGE_PREFIX}:${serverHost}` : STORAGE_PREFIX;
}

/**
 * Reads either shape.
 *
 * Before counts this was a plain `string[]`, most-recent-first, and that is
 * what sits in every existing install. Those come back as one use each, ordered
 * so the old recency survives — nobody's row reshuffles on upgrade, and counts
 * build from there.
 */
function readStorage(serverHost: string | undefined): ReactionUse[] {
  try {
    const raw = localStorage.getItem(storageKey(serverHost));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    if (parsed.every((v) => typeof v === "string")) {
      const now = Date.now();
      return (parsed as string[]).map((src, i) => ({ src, count: 1, usedAt: now - i }));
    }

    return parsed.filter((v): v is ReactionUse =>
      !!v && typeof v === "object"
      && typeof (v as ReactionUse).src === "string"
      && typeof (v as ReactionUse).count === "number"
      && typeof (v as ReactionUse).usedAt === "number");
  } catch {
    // Corrupt or unreadable storage. An empty list falls through to the
    // defaults below, which is a working toolbar rather than an empty one.
  }
  return [];
}

function writeStorage(serverHost: string | undefined, list: ReactionUse[]): void {
  try {
    localStorage.setItem(storageKey(serverHost), JSON.stringify(list));
  } catch {
    // Storage full or unavailable. The ordering holds for this session and is
    // gone next launch, which costs somebody their row and nothing else.
  }
}

/** Pads a short list out to `count` with defaults, skipping any already there. */
function padWithDefaults(picked: string[], count: number): string[] {
  if (picked.length >= count) return picked.slice(0, count);
  const filler = DEFAULT_REACTIONS.filter((d) => !picked.includes(d));
  return [...picked, ...filler].slice(0, count);
}

/** Most recently used first. What the picker's recents row shows. */
export function getRecentReactions(count = 6, serverHost?: string): string[] {
  const stored = [...readStorage(serverHost)].sort((a, b) => b.usedAt - a.usedAt);
  return padWithDefaults(stored.map((r) => r.src), count);
}

/**
 * Most used first, with the more recent one winning a tie.
 *
 * The tiebreak earns its place: without it, everything on a single use sits in
 * whatever order the array happened to hold, and the toolbar's buttons trade
 * places between renders.
 */
export function getFrequentReactions(count = 4, serverHost?: string): string[] {
  const stored = [...readStorage(serverHost)].sort(
    (a, b) => b.count - a.count || b.usedAt - a.usedAt,
  );
  return padWithDefaults(stored.map((r) => r.src), count);
}

export function recordReaction(src: string, serverHost?: string): void {
  const stored = readStorage(serverHost);
  const existing = stored.find((r) => r.src === src);
  const updated: ReactionUse[] = existing
    ? stored.map((r) => (r.src === src ? { ...r, count: r.count + 1, usedAt: Date.now() } : r))
    : [{ src, count: 1, usedAt: Date.now() }, ...stored];

  // Trimmed by use rather than by age, so something reached for constantly is
  // not pushed out by thirty one-offs.
  const trimmed = [...updated]
    .sort((a, b) => b.count - a.count || b.usedAt - a.usedAt)
    .slice(0, MAX_STORED);

  writeStorage(serverHost, trimmed);
}
