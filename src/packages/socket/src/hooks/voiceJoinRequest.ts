import { useSyncExternalStore } from "react";

/**
 * A voice channel somebody asked to join from outside its server, such as the
 * In voice tiles on Messages home. The server view claims it once that server is on screen.
 */

let pending: { host: string; channelId: string } | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function requestVoiceJoin(host: string, channelId: string): void {
  pending = { host, channelId };
  emit();
}

/** Taken by the view that joins it, so it joins once. */
export function takeVoiceJoin(host: string): string | null {
  if (!pending || pending.host !== host) return null;
  const { channelId } = pending;
  pending = null;
  emit();
  return channelId;
}

export function usePendingVoiceJoin(): { host: string; channelId: string } | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
    () => pending,
  );
}
