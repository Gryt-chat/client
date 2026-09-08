import { useCallback, useSyncExternalStore } from "react";

/**
 * How many replies have arrived in a thread that nobody has read.
 *
 * Its own store rather than a third key on the unread tracker next door, which
 * is `(host, conversationId)` all the way down. A thread hangs off a
 * conversation but is not one, and threading a second id through that map would
 * make every call site say which kind of thing it was asking about.
 *
 * This is why GRYT-999 had to go silent. A reply in a thread was badging the
 * parent channel and then being filtered out of it, so the badge pointed at
 * something that looked empty; the honest fix was to say nothing until there
 * was somewhere to say it. This is that somewhere.
 *
 * Counted from when this window connected, like the channel one and for the
 * same reason: no server-side read marker exists. GRYT-985.
 */
interface ThreadUnread {
  /**
   * The channel the thread hangs off.
   *
   * Kept so "mark this channel read" can find the threads in it (GRYT-1030).
   * Keyed by thread alone, the store can answer how many are unread in one
   * thread and how many on a whole server, and nothing in between — which is
   * the scope somebody most often wants.
   */
  conversationId: string;
  count: number;
}

type ThreadUnreadMap = Map<string, Map<string, ThreadUnread>>;

let unread: ThreadUnreadMap = new Map();
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ThreadUnreadMap {
  return unread;
}

/** The store as it stands, for a test with no React to render into. */
export function getThreadUnreadSnapshot(): ThreadUnreadMap {
  return unread;
}

/**
 * The thread on screen, if any.
 *
 * Held here rather than answered by whoever is counting, because the count and
 * the panel are two `chat:new` handlers on one socket and which runs first is
 * whichever subscribed first. Clearing on arrival raced the increment and lost
 * about half the time; refusing to count the open one cannot race anything.
 */
let openThread: { host: string; threadId: string } | null = null;

export function setOpenThread(host: string, threadId: string | null) {
  openThread = threadId ? { host, threadId } : null;
  if (threadId) markThreadRead(host, threadId);
}

export function markThreadUnread(host: string, conversationId: string, threadId: string) {
  if (openThread && openThread.host === host && openThread.threadId === threadId) return;
  const existing = unread.get(host);
  const next = new Map(unread);
  const counts = new Map(existing);
  counts.set(threadId, { conversationId, count: (counts.get(threadId)?.count ?? 0) + 1 });
  next.set(host, counts);
  unread = next;
  emitChange();
}

/** They have the thread open, or have just opened it. */
export function markThreadRead(host: string, threadId: string) {
  const existing = unread.get(host);
  if (!existing?.has(threadId)) return;
  const next = new Map(unread);
  const counts = new Map(existing);
  counts.delete(threadId);
  if (counts.size === 0) next.delete(host);
  else next.set(host, counts);
  unread = next;
  emitChange();
}

/**
 * Every thread hanging off one channel, for a "mark as read" on it.
 *
 * A thread whose replies have not arrived in this window is not in here at
 * all, which is the same limit the channel counts have: both are counted from
 * when this window connected, because no server-side read marker exists.
 */
export function markConversationThreadsRead(host: string, conversationId: string) {
  const existing = unread.get(host);
  if (!existing) return;

  const counts = new Map(existing);
  let removed = false;
  for (const [threadId, entry] of counts) {
    if (entry.conversationId !== conversationId) continue;
    counts.delete(threadId);
    removed = true;
  }
  if (!removed) return;

  const next = new Map(unread);
  if (counts.size === 0) next.delete(host);
  else next.set(host, counts);
  unread = next;
  emitChange();
}

/** Leaving a server, or marking everything in it read. */
export function clearServerThreadUnread(host: string) {
  if (!unread.has(host)) return;
  const next = new Map(unread);
  next.delete(host);
  unread = next;
  emitChange();
}

export function useThreadUnread() {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const threadUnreadCount = useCallback(
    (host: string, threadId: string): number => map.get(host)?.get(threadId)?.count ?? 0,
    [map],
  );

  /** Unread replies across every thread hanging off one channel. */
  const conversationThreadUnreadCount = useCallback(
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

  /** Unread replies across every thread on one server. */
  const serverThreadUnreadCount = useCallback(
    (host: string): number => {
      let total = 0;
      for (const entry of map.get(host)?.values() ?? []) total += entry.count;
      return total;
    },
    [map],
  );

  const getThreadUnreadCounts = useCallback(
    (host: string): Map<string, number> =>
      new Map([...(map.get(host) ?? [])].map(([threadId, e]) => [threadId, e.count])),
    [map],
  );

  return { threadUnreadCount, conversationThreadUnreadCount, serverThreadUnreadCount, getThreadUnreadCounts };
}
