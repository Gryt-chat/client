/**
 * The on switch for fake chat. Deliberately module state rather than a setting: a
 * persisted flag means fake messages arriving in a real conversation days later.
 */
import { useSyncExternalStore } from "react";

let running = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setFakeChatRunning(next: boolean): void {
  if (!import.meta.env.DEV) return;
  if (running === next) return;
  running = next;
  emit();
}

export function isFakeChatRunning(): boolean {
  return running;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFakeChatRunning(): boolean {
  return useSyncExternalStore(subscribe, isFakeChatRunning, () => false);
}
