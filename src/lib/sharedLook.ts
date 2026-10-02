/** A card style or an owl that arrived by a gryt:// link, waiting for the settings page that shows it before it's used. */

import { useSyncExternalStore } from "react";

export interface SharedLook {
  /** A card style as a query string, as the card builder writes it. */
  card?: string;
  /** A copied server banner. It stays local until the card is saved. */
  cardBanner?: string | null;
  /** An owl as a worn string. */
  owl?: string;
}

let pending: SharedLook = {};
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((fn) => fn());

export function offerSharedLook(look: SharedLook): void {
  pending = { ...pending, ...look };
  emit();
}

/** Takes it, so it is shown once. */
export function takeSharedLook<K extends keyof SharedLook>(kind: K): SharedLook[K] {
  const value = pending[kind];
  if (value === undefined) return undefined;
  pending = { ...pending, [kind]: undefined };
  emit();
  return value;
}

export function useSharedLook(): SharedLook {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => pending,
  );
}
