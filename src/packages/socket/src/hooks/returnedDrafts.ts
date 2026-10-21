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

/* Channel drafts on disk, so one survives a restart. DMs stay in memory: their history
   on disk is sealed with the archive key, and a plain-text draft beside it would undo that. */
const DB_NAME = "gryt_drafts";
const STORE = "drafts";

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open the drafts store"));
  });
}

/** Keeps a channel's draft on disk, or forgets it once it's empty. */
export async function saveDraftToDisk(key: string, draft: ReturnedDraft): Promise<void> {
  if (!key || typeof indexedDB === "undefined") return;
  const db = await openDraftDb();
  const tx = db.transaction(STORE, "readwrite");
  if (draft.text || draft.files.length > 0) tx.objectStore(STORE).put(draft, key);
  else tx.objectStore(STORE).delete(key);
  tx.oncomplete = () => db.close();
}

/** The drafts left on disk last time, each sent back to wait for its box. */
async function loadDraftsFromDisk(): Promise<void> {
  const db = await openDraftDb();
  const tx = db.transaction(STORE, "readonly");
  const keys = tx.objectStore(STORE).getAllKeys();
  const values = tx.objectStore(STORE).getAll();
  tx.oncomplete = () => {
    db.close();
    keys.result.forEach((key, i) => {
      if (typeof key === "string" && !drafts.has(key)) returnDraft(key, values.result[i] as ReturnedDraft);
    });
  };
}

if (typeof indexedDB !== "undefined") loadDraftsFromDisk().catch(() => {});
