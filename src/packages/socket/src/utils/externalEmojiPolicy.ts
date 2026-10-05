/* Which servers let other Gryt servers' emoji show in their messages (GRYT-1660). Kept apart from
   the server details so a message re-renders only when this answer changes. */

import { useSyncExternalStore } from "react";

const allowed = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function setExternalEmojisAllowed(host: string, on: boolean): void {
  if (allowed.get(host) === on) return;
  allowed.set(host, on);
  listeners.forEach((fn) => fn());
}

export function externalEmojisAllowed(host: string | null | undefined): boolean {
  return !!host && allowed.get(host) === true;
}

export function useExternalEmojisAllowed(host: string | null | undefined): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => externalEmojisAllowed(host),
  );
}
