import { useCallback, useSyncExternalStore } from "react";

/**
 * How many replies have arrived in a thread that nobody has read. Its own store:
 * a thread hangs off a conversation but is not one. Counted from connect.
 */
interface ThreadUnread {
  /**
   * The channel the thread hangs off, kept so "mark this channel read" can find
   * the threads in it (GRYT-1030).
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
 * The thread on screen, if any. Held here because the count and the panel are two
 * `chat:new` handlers on one socket, and clearing on arrival raced.
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
 * Every thread hanging off one channel, for a "mark as read" on it. A thread
 * whose replies have not arrived in this window is not in here at all.
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
