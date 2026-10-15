import { useSyncExternalStore } from "react";

/**
 * Per conversation, on this device: whether its unencrypted messages still carry the red
 * dot (board 5b), and when it last switched to encrypted on its own (GRYT-1754).
 */

const HIDDEN_KEY = "gryt.unencryptedMarksHidden";
const SEALED_KEY = "gryt.encryptedSince";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function read(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(key: string, value: Record<string, number>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full store: the choice lasts until the window closes.
  }
  emit();
}

const id = (host: string, conversationId: string) => `${host}/${conversationId}`;

export function marksHidden(host: string, conversationId: string): boolean {
  return id(host, conversationId) in read(HIDDEN_KEY);
}

export function useMarksHidden(host: string | undefined, conversationId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => (host && conversationId ? marksHidden(host, conversationId) : false));
}

export function setMarksHidden(host: string, conversationId: string, hidden: boolean): void {
  const all = read(HIDDEN_KEY);
  if (hidden) all[id(host, conversationId)] = Date.now();
  else delete all[id(host, conversationId)];
  write(HIDDEN_KEY, all);
}

/** When this device saw the conversation switch from unencrypted to encrypted. */
export function encryptedSince(host: string, conversationId: string): number | null {
  return read(SEALED_KEY)[id(host, conversationId)] ?? null;
}

export function noteEncrypted(host: string, conversationId: string, at = Date.now()): void {
  write(SEALED_KEY, { ...read(SEALED_KEY), [id(host, conversationId)]: at });
}
