import { useCallback, useSyncExternalStore } from "react";

/**
 * How many messages have arrived in a conversation that nobody has looked at.
 *
 * A count rather than a flag. The flag it replaced drew a dot, and a dot on a
 * server icon says only that something happened somewhere in it — which on a
 * server with a busy general channel is always true, so it stopped carrying
 * information the moment you joined anything active.
 *
 * Distinct from the mention tracker next door, which counts the messages that
 * named *you*. Both are shown: the count is how much is waiting, a mention is
 * why you might want to go now. Where both exist the mention wins the badge,
 * because it is the more urgent of the two.
 *
 * **Counted from when this window connected, not from a server-side read
 * marker.** Nothing persists it and no server sends it, so a reconnect starts
 * the count over — the same limit the flag had, made visible by being a number.
 * GRYT-985 is the server-side version.
 *
 * The store lives at module scope so a message that arrives while the channel
 * list is unmounted is still counted when it comes back.
 */
type UnreadMap = Map<string, Map<string, number>>;

let unreadMap: UnreadMap = new Map();
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): UnreadMap {
  return unreadMap;
}

/**
 * The store as it stands, for a test with no React to render into. Exported
 * rather than reached through the hook because what is worth checking here is
 * the arithmetic.
 */
export function getUnreadSnapshot(): UnreadMap {
  return unreadMap;
}

/** One more message nobody has read. */
export function markChannelUnread(host: string, channelId: string) {
  const existing = unreadMap.get(host);
  const next = new Map(unreadMap);
  const counts = new Map(existing);
  counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
  next.set(host, counts);
  unreadMap = next;
  emitChange();
}

export function markChannelRead(host: string, channelId: string) {
  const existing = unreadMap.get(host);
  if (!existing?.has(channelId)) return;
  const next = new Map(unreadMap);
  const counts = new Map(existing);
  counts.delete(channelId);
  if (counts.size === 0) {
    next.delete(host);
  } else {
    next.set(host, counts);
  }
  unreadMap = next;
  emitChange();
}

export function markServerRead(host: string) {
  if (!unreadMap.has(host)) return;
  const next = new Map(unreadMap);
  next.delete(host);
  unreadMap = next;
  emitChange();
}

export function useUnreadTracker() {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const serverUnreadCount = useCallback(
    (host: string): number => {
      let total = 0;
      for (const n of map.get(host)?.values() ?? []) total += n;
      return total;
    },
    [map],
  );

  const channelUnreadCount = useCallback(
    (host: string, channelId: string): number =>
      map.get(host)?.get(channelId) ?? 0,
    [map],
  );

  const serverHasUnread = useCallback(
    (host: string): boolean => (map.get(host)?.size ?? 0) > 0,
    [map],
  );

  const channelHasUnread = useCallback(
    (host: string, channelId: string): boolean =>
      (map.get(host)?.get(channelId) ?? 0) > 0,
    [map],
  );

  const getUnreadCounts = useCallback(
    (host: string): Map<string, number> => map.get(host) ?? new Map(),
    [map],
  );

  return {
    serverUnreadCount,
    channelUnreadCount,
    serverHasUnread,
    channelHasUnread,
    getUnreadCounts,
  };
}
