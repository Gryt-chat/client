import { useSyncExternalStore } from "react";

/** Servers being left: off the sidebar at once, while the leave is still being sent in the background. */
let leaving: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function setLeaving(host: string, on: boolean) {
  const next = new Set(leaving);
  if (on) next.add(host);
  else next.delete(host);
  leaving = next;
  for (const l of listeners) l();
}

export function useLeavingServers(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => leaving,
  );
}
