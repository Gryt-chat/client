import { useSyncExternalStore } from "react";

import type { ThreadSummary } from "./useThreads";

/*
 * The thread the panel is showing, held outside React. Narrowing the window
 * swaps ChatView for another one, and what the old one knew went with it.
 */
interface RememberedThread {
  host: string;
  conversationId: string;
  thread: ThreadSummary;
}

let remembered: RememberedThread | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function rememberOpenThread(host: string, conversationId: string, thread: ThreadSummary): void {
  const first = !remembered;
  remembered = { host, conversationId, thread };
  if (first) emit();
}

export function forgetOpenThread(): void {
  if (!remembered) return;
  remembered = null;
  emit();
}

/** The thread this conversation had open, if it is the one that was remembered. */
export function recallOpenThread(host: string, conversationId: string): ThreadSummary | null {
  if (!remembered) return null;
  if (remembered.host !== host || remembered.conversationId !== conversationId) return null;
  return remembered.thread;
}

/** Whether a thread is on screen at all, for the layout around the chat pane. */
export function useOpenThread(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => remembered !== null,
    () => false,
  );
}
