import { useSyncExternalStore } from "react";

/** A message that did not go out, on its way back to the box it was typed in. */
export interface ReturnedDraft {
  text: string;
  files: File[];
}

/* Keyed by server and conversation, so a draft waits for its own box after you
   move on instead of landing in whichever one is open. */
const drafts = new Map<string, ReturnedDraft>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function draftKey(host: string, conversationId: string, threadId?: string | null): string {
  return threadId ? `${host}::${conversationId}::${threadId}` : `${host}::${conversationId}`;
}

/** Hands a message back to its composer. A second one before it is picked up adds to the first. */
export function returnDraft(key: string, draft: ReturnedDraft): void {
  if (!key || (!draft.text && draft.files.length === 0)) return;
  const earlier = drafts.get(key);
  drafts.set(key, earlier
    ? { text: [earlier.text, draft.text].filter(Boolean).join("\n"), files: [...earlier.files, ...draft.files] }
    : draft);
  emit();
}

/** Taken rather than read, so it goes back once. */
export function takeReturnedDraft(key: string): ReturnedDraft | null {
  const draft = drafts.get(key) ?? null;
  if (!draft) return null;
  drafts.delete(key);
  emit();
  return draft;
}

/** The draft waiting for this composer, so it re-renders when one arrives. */
export function useReturnedDraft(key: string): ReturnedDraft | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (key ? drafts.get(key) ?? null : null),
    () => null,
  );
}
