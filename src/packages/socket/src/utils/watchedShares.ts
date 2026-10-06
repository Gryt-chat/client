/* Which screen shares you have chosen to watch, by the share's video stream id (GRYT-1681).
   Keyed by stream rather than person, so a share that stops and starts again waits for a click. */

import { useSyncExternalStore } from "react";

let watched = new Set<string>();
const listeners = new Set<() => void>();

function emit(next: Set<string>): void {
  watched = next;
  listeners.forEach((fn) => fn());
}

export function watchShare(videoStreamId: string): void {
  if (!videoStreamId || watched.has(videoStreamId)) return;
  emit(new Set(watched).add(videoStreamId));
}

export function stopWatchingShare(videoStreamId: string): void {
  if (!watched.has(videoStreamId)) return;
  const next = new Set(watched);
  next.delete(videoStreamId);
  emit(next);
}

export function isWatchingShare(videoStreamId: string | null | undefined): boolean {
  return !!videoStreamId && watched.has(videoStreamId);
}

export function useWatchedShares(): ReadonlySet<string> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => watched,
  );
}
