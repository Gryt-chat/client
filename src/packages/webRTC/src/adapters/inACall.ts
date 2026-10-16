import { useSyncExternalStore } from "react";

/** Whether the room joined is a DM or group call rather than a voice channel (GRYT-1785).
    serverView knows from its conversations; the leave buttons read it. */
let current = false;
const listeners = new Set<() => void>();

export function setInACall(next: boolean) {
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export function useInACall(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}
