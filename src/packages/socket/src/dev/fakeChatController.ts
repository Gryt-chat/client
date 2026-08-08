/**
 * The on switch for fake chat, shared between the button and the thing it runs.
 *
 * The button lives in Settings → Developer and the messages are produced in the
 * server view, which are far enough apart that this would otherwise have to go
 * through the settings store. It deliberately does not: a persisted flag means
 * a fixture that survives a restart, and the first thing you would know about
 * it is fake messages arriving in a real conversation days later.
 *
 * So it is module state, and it resets when the app does. Stopping is one
 * click, quitting is the other.
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
