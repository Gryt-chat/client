import { useSyncExternalStore } from "react";

/* Asking to see the note again, from the About page. A counter rather than a
   flag: asking twice in a row has to reopen it the second time. GRYT-1145. */
let requested = 0;
const listeners = new Set<() => void>();

export function requestWhatsNew(): void {
  requested += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => requested;

/** Changes every time somebody asks. The value itself means nothing. */
export function useWhatsNewRequested(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
