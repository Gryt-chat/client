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
let expanded = false;
let closer: (() => void) | null = null;
/* What each conversation had open when you left it. In memory only, so a restart starts clean. */
const parked = new Map<string, { thread: ThreadSummary; expanded: boolean }>();
const parkedKey = (host: string, conversationId: string) => `${host}\n${conversationId}`;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function rememberOpenThread(host: string, conversationId: string, thread: ThreadSummary): void {
  const changed = remembered?.thread.thread_id !== thread.thread_id || remembered?.thread.title !== thread.title;
  remembered = { host, conversationId, thread };
  if (changed) emit();
}

export function forgetOpenThread(): void {
  if (!remembered) return;
  remembered = null;
  expanded = false;
  emit();
}

/** Leave the open thread with its conversation, for `resumeParkedThread` to bring back. */
export function parkOpenThread(): void {
  if (!remembered) return;
  parked.set(parkedKey(remembered.host, remembered.conversationId), { thread: remembered.thread, expanded });
  forgetOpenThread();
}

/** Makes what this conversation left open the open thread again. */
export function resumeParkedThread(host: string, conversationId: string): void {
  const key = parkedKey(host, conversationId);
  const left = parked.get(key);
  if (!left) return;
  parked.delete(key);
  rememberOpenThread(host, conversationId, left.thread);
  setThreadExpanded(left.expanded);
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

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The open thread itself, for the row the channel list draws under its channel. */
export function useRememberedThread(): RememberedThread | null {
  return useSyncExternalStore(subscribe, () => remembered, () => null);
}

export function useThreadExpanded(): boolean {
  return useSyncExternalStore(subscribe, () => expanded, () => false);
}

export function setThreadExpanded(next: boolean): void {
  if (expanded === next) return;
  expanded = next;
  emit();
}

/* ChatView owns closing, because it saves a half-written reply first. The channel list is elsewhere in the tree. */
export function registerThreadCloser(close: (() => void) | null): void {
  closer = close;
}

export function closeOpenThread(): void {
  closer?.();
}
