import { useCallback, useSyncExternalStore } from "react";

/**
 * How many times somebody has been named in a thread and not read it.
 *
 * The mention tracker next door is keyed by conversation, so a naming inside a
 * thread landed on the parent channel with nowhere to point. The server now
 * says which thread it was (GRYT-1012); this is where that goes.
 *
 * The channel count keeps counting it too, and that is deliberate rather than
 * double counting: the channel badge is how somebody notices, and this is how
 * they find it. Which is also why each entry carries its conversation. Opening
 * a channel clears the mentions in its timeline and leaves the threads, so the
 * client has to know how much of a channel's count is thread-shaped to clear
 * the right amount without waiting for the server to answer (GRYT-1014).
 *
 * Server-backed, unlike the thread unread count beside it. `mentions:list`
 * answers the whole set on connect, so this survives a reload and two windows
 * cannot disagree — which is why `set` replaces rather than merges.
 */
interface ThreadMention {
  conversationId: string;
  count: number;
}

type ThreadMentionMap = Map<string, Map<string, ThreadMention>>;

let mentions: ThreadMentionMap = new Map();
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ThreadMentionMap {
  return mentions;
}

/** The store as it stands, for a test with no React to render into. */
export function getThreadMentionSnapshot(): ThreadMentionMap {
  return mentions;
}

/**
 * Replace one server's counts from the server's own answer.
 *
 * Built from the mention rows rather than from the `threadCounts` beside them,
 * because those are keyed by thread alone and the conversation is needed here.
 * Replace rather than merge, like the conversation tracker: the server has just
 * said everything that is unseen, so anything held here it did not name has
 * been read somewhere else.
 */
export function setThreadMentionCounts(
  host: string,
  rows: Array<{ conversation_id?: string; thread_id?: string | null }>,
) {
  const counts = new Map<string, ThreadMention>();
  for (const row of rows) {
    if (!row?.thread_id || !row.conversation_id) continue;
    const existing = counts.get(row.thread_id);
    if (existing) existing.count += 1;
    else counts.set(row.thread_id, { conversationId: row.conversation_id, count: 1 });
  }

  const next = new Map(mentions);
  if (counts.size === 0) next.delete(host);
  else next.set(host, counts);
  mentions = next;
  emitChange();
}

/** One more, from a naming that arrived while we were connected. */
export function addThreadMention(host: string, conversationId: string, threadId: string) {
  const counts = new Map(mentions.get(host));
  const existing = counts.get(threadId);
  counts.set(threadId, { conversationId, count: (existing?.count ?? 0) + 1 });

  const next = new Map(mentions);
  next.set(host, counts);
  mentions = next;
  emitChange();
}

/** They have read the thread. */
export function clearThreadMentions(host: string, threadId: string) {
  const existing = mentions.get(host);
  if (!existing?.has(threadId)) return;

  const counts = new Map(existing);
  counts.delete(threadId);
  const next = new Map(mentions);
  if (counts.size === 0) next.delete(host);
  else next.set(host, counts);
  mentions = next;
  emitChange();
}

/** Every thread hanging off one channel, for a "mark as read" on it. */
export function clearConversationThreadMentions(host: string, conversationId: string) {
  const existing = mentions.get(host);
  if (!existing) return;

  const counts = new Map(existing);
  let removed = false;
  for (const [threadId, entry] of counts) {
    if (entry.conversationId !== conversationId) continue;
    counts.delete(threadId);
    removed = true;
  }
  if (!removed) return;

  const next = new Map(mentions);
  if (counts.size === 0) next.delete(host);
  else next.set(host, counts);
  mentions = next;
  emitChange();
}

/** Leaving a server, or marking everything in it read. */
export function clearServerThreadMentions(host: string) {
  if (!mentions.has(host)) return;
  const next = new Map(mentions);
  next.delete(host);
  mentions = next;
  emitChange();
}

/**
 * How much of a conversation's mention count is sitting inside its threads.
 *
 * Opening the channel does not clear these, so this is what has to survive the
 * clear rather than what gets cleared.
 */
export function conversationThreadMentions(host: string, conversationId: string): number {
  const counts = mentions.get(host);
  if (!counts) return 0;
  let total = 0;
  for (const entry of counts.values()) {
    if (entry.conversationId === conversationId) total += entry.count;
  }
  return total;
}

export function useThreadMentions() {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const threadMentionCount = useCallback(
    (host: string, threadId: string): number => map.get(host)?.get(threadId)?.count ?? 0,
    [map],
  );

  const conversationThreadMentionCount = useCallback(
    (host: string, conversationId: string): number => {
      const counts = map.get(host);
      if (!counts) return 0;
      let total = 0;
      for (const entry of counts.values()) {
        if (entry.conversationId === conversationId) total += entry.count;
      }
      return total;
    },
    [map],
  );

  return { threadMentionCount, conversationThreadMentionCount };
}
