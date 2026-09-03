import { useCallback, useSyncExternalStore } from "react";

/**
 * How many times somebody has been named in a conversation and not read it.
 *
 * Separate from the unread tracker next door, which answers a different
 * question: unread means something happened here, a mention means something
 * happened *to you*. On a server with a busy general channel the first is
 * always true and stops carrying information, and the question that actually
 * needs answering — did anyone ask me something — is the one that gets lost.
 *
 * A count rather than a flag, because "three people asked you something" and
 * "one person did" are different amounts of owed reply, and the number is what
 * the server stores anyway.
 *
 * The store lives at module scope, like the unread one, so a mention that
 * arrives while the channel list is unmounted is still there when it comes
 * back.
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
 * The store as it stands, for a test that has no React to render into.
 *
 * Exported rather than reached for through the hook because the hook needs a
 * component, and what is worth checking here is the arithmetic rather than the
 * subscription.
 */
export function getMentionSnapshot(): MentionMap {
  return mentionMap;
}

/**
 * Replace what one server's counts are, from the server's own answer.
 *
 * Replace rather than merge: the server has just told us everything that is
 * unseen, so anything held here that it did not mention has been read
 * elsewhere — on a phone, or in another window.
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

/** They have read this conversation. */
export function clearMentions(host: string, conversationId: string) {
  const existing = mentionMap.get(host);
  if (!existing?.has(conversationId)) return;
  const next = new Map(mentionMap);
  const counts = new Map(existing);
  counts.delete(conversationId);
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
