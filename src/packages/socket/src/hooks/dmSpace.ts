import { useSyncExternalStore } from "react";

/**
 * Whether the direct messages space is the thing on screen. A store rather than
 * a field on useServerManagement, which is already the largest hook here.
 */

let open = false;
/* Which conversation the space asked for. Read by the server view when it
   mounts: the space replaces that view, so an event has nobody to hear it. */
let pending: { host: string; conversationId: string } | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/* The conversation this visit asked for. A conversation nobody has written in is
   listed only while it is this one, so clicking through people leaves no rows. */
let visiting: string | null = null;

/* Where the space was, kept here rather than in the view: leaving unmounts the
   view, so state inside it is gone on the way back. GRYT-1146. */
let last: { host: string; conversationId: string } | null = null;

/** The space showed this one, so it is where to come back to. */
export function rememberConversation(host: string, conversationId: string): void {
  // The same place again is not news, and a fresh object would re-render readers.
  if (last && last.host === host && last.conversationId === conversationId) return;
  last = { host, conversationId };
  emit();
}

export function lastConversation(): { host: string; conversationId: string } | null {
  return last;
}

/** Re-renders when the space moves, which the plain read above cannot. */
export function useLastConversation(): { host: string; conversationId: string } | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    lastConversation,
    lastConversation,
  );
}

export function setDmSpaceOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  /* Leaving forgets it. Coming back through the rail is a fresh visit and shows
     the overview, which is what "click it and you see the dms overview" means. */
  if (!next) visiting = null;
  emit();
}

/** Which conversation is worth listing even with nothing in it. */
export function visitingConversation(): string | null {
  return visiting;
}

export function useVisitingConversation(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    visitingConversation,
    visitingConversation,
  );
}

export function isDmSpaceOpen(): boolean {
  return open;
}

/** Ask for a conversation, then leave. The view claims it once it is there. */
export function requestConversation(host: string, conversationId: string): void {
  pending = { host, conversationId };
  visiting = conversationId;
  emit();
}

/**
 * What this host was asked to open, without consuming it. Effects run twice
 * under StrictMode, and a one-shot read loses the race with the reset beside it.
 */
export function conversationFor(host: string): string | null {
  return pending && pending.host === host ? pending.conversationId : null;
}

/** Cleared once the view is actually showing it, so it opens once. */
export function conversationOpened(conversationId: string): void {
  if (pending?.conversationId !== conversationId) return;
  pending = null;
  emit();
}

/** What the space asked for, so a view re-renders when it is set. */
export function usePendingConversation(): { host: string; conversationId: string } | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
    () => pending,
  );
}

/** For a test, so one case cannot leak into the next. */
export function resetDmSpace(): void {
  open = false;
  visiting = null;
  last = null;
  pending = null;
  emit();
}

export function useDmSpaceOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => open,
  );
}
