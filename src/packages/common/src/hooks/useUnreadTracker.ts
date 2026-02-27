import { useCallback, useSyncExternalStore } from "react";

type UnreadMap = Map<string, Set<string>>;

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

export function markChannelUnread(host: string, channelId: string) {
  const existing = unreadMap.get(host);
  if (existing?.has(channelId)) return;
  const next = new Map(unreadMap);
  const set = new Set(existing);
  set.add(channelId);
  next.set(host, set);
  unreadMap = next;
  emitChange();
}

export function markChannelRead(host: string, channelId: string) {
  const existing = unreadMap.get(host);
  if (!existing?.has(channelId)) return;
  const next = new Map(unreadMap);
  const set = new Set(existing);
  set.delete(channelId);
  if (set.size === 0) {
    next.delete(host);
  } else {
    next.set(host, set);
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

  const serverHasUnread = useCallback(
    (host: string): boolean => {
      const set = map.get(host);
      return !!set && set.size > 0;
    },
    [map],
  );

  const channelHasUnread = useCallback(
    (host: string, channelId: string): boolean => {
      const set = map.get(host);
      return !!set && set.has(channelId);
    },
    [map],
  );

  const getUnreadChannels = useCallback(
    (host: string): Set<string> => map.get(host) ?? new Set(),
    [map],
  );

  return { serverHasUnread, channelHasUnread, getUnreadChannels };
}
