import { useSyncExternalStore } from "react";

/**
 * Whether the new-message dialog is up. A store, so the dialog can sit above the
 * server view: a group made on another server moves that view, and the step after it has to survive.
 */

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setNewMessageOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}

export function useNewMessageOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => open,
  );
}
