import { useCallback, useSyncExternalStore } from "react";

/**
 * How many times somebody has been named in a conversation and not read it.
 * Unread means something happened here; a mention means it happened *to you*.
 */
type MentionMap = Map<string, Map<string, number>>;

let mentionMap: MentionMap = new Map();
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): MentionMap {
  return mentionMap;
}

/**
 * The store as it stands, for a test that has no React to render into. What is
 * worth checking here is the arithmetic rather than the subscription.
 */
export function getMentionSnapshot(): MentionMap {
  return mentionMap;
}

/**
 * Replace what one server's counts are, from the server's own answer. Replace
 * rather than merge: anything it did not mention has been read elsewhere.
 */
export function setMentionCounts(host: string, counts: Record<string, number>) {
  const next = new Map(mentionMap);
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) next.delete(host);
  else next.set(host, new Map(entries));
  mentionMap = next;
  emitChange();
}

/** One more, from a message that arrived while we were connected. */
export function addMention(host: string, conversationId: string) {
  const existing = mentionMap.get(host);
  const next = new Map(mentionMap);
  const counts = new Map(existing);
  counts.set(conversationId, (counts.get(conversationId) ?? 0) + 1);
  next.set(host, counts);
  mentionMap = next;
  emitChange();
}

/**
 * They have read this conversation. `keep` is what the server will not have
 * cleared: mentions inside the conversation's threads (GRYT-1014).
 */
export function clearMentions(host: string, conversationId: string, keep = 0) {
  const existing = mentionMap.get(host);
  if (!existing?.has(conversationId)) return;
  const next = new Map(mentionMap);
  const counts = new Map(existing);
  if (keep > 0) counts.set(conversationId, keep);
  else counts.delete(conversationId);
  if (counts.size === 0) next.delete(host);
  else next.set(host, counts);
  mentionMap = next;
  emitChange();
}

/** Everything on one server, for leaving it or for a "mark all read". */
export function clearServerMentions(host: string) {
  if (!mentionMap.has(host)) return;
  const next = new Map(mentionMap);
  next.delete(host);
  mentionMap = next;
  emitChange();
}

export function useMentionTracker() {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const serverMentionCount = useCallback(
    (host: string): number => {
      let total = 0;
      for (const n of map.get(host)?.values() ?? []) total += n;
      return total;
    },
    [map],
  );

  const conversationMentionCount = useCallback(
    (host: string, conversationId: string): number =>
      map.get(host)?.get(conversationId) ?? 0,
    [map],
  );

  const getMentionCounts = useCallback(
    (host: string): Map<string, number> => map.get(host) ?? new Map(),
    [map],
  );

  return { serverMentionCount, conversationMentionCount, getMentionCounts };
}
