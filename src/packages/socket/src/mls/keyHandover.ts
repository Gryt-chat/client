import { useSyncExternalStore } from "react";

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const listener of listeners) listener();
    },
    use: () =>
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => value,
      ),
  };
}

/** Per server, a pending key reset: when it takes over, and whether this device holds the key it replaces. */
export const keyResets = store<Readonly<Record<string, { at: number; holdsCurrentKey: boolean }>>>({});
