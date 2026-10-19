/* eslint-disable @typescript-eslint/ban-types -- unknown: stored and parsed data arrives unchecked and is validated here. Remove as each is typed (GRYT-1792). */

import { useSyncExternalStore } from "react";

import { getOwnServerUserId } from "@/common";

import type { DirectoryEntry } from "./dmDirectory";

/**
 * Conversations pinned to the top of this device's Messages list, in the order
 * they were dragged into. Per device and per account; the server never hears of it.
 */

const STORAGE_KEY = "gryt:pinnedConversations";

/** One pin: the server, your account on it, and the conversation. */
export interface Pin {
  host: string;
  serverUserId: string;
  conversationId: string;
}

function same(a: Pin, b: Pin): boolean {
  return a.host === b.host && a.serverUserId === b.serverUserId && a.conversationId === b.conversationId;
}

function read(): Pin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Pin =>
        !!p && typeof p.host === "string" && typeof p.serverUserId === "string" && typeof p.conversationId === "string",
    );
  } catch {
    // A private window or cleared storage: nothing pinned, which is safe to be wrong about.
    return [];
  }
}

let pins: readonly Pin[] = read();
const listeners = new Set<() => void>();

function write(next: Pin[]): void {
  pins = next;
  try {
    if (next.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Holds for this session.
  }
  for (const listener of listeners) listener();
}

/** The pin a row in the list stands for: its server, your account there, the conversation. */
export function pinFor(entry: DirectoryEntry): Pin {
  return {
    host: entry.host,
    serverUserId: getOwnServerUserId(entry.host) ?? "",
    conversationId: entry.conversation.conversation_id,
  };
}

export function isPinned(pin: Pin): boolean {
  return pins.some((p) => same(p, pin));
}

/** Pinned goes to the bottom of the pinned group, where a drag can move it. */
export function setPinned(pin: Pin, pinned: boolean): void {
  const without = pins.filter((p) => !same(p, pin));
  write(pinned ? [...without, pin] : without);
}

/** The new order of one account's pins, as the drag left them. Other accounts keep theirs. */
export function reorderPins(order: Pin[]): void {
  const moved = new Set(order.map((p) => JSON.stringify([p.host, p.serverUserId, p.conversationId])));
  const rest = pins.filter((p) => !moved.has(JSON.stringify([p.host, p.serverUserId, p.conversationId])));
  write([...order, ...rest]);
}

export function usePins(): readonly Pin[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pins,
    () => pins,
  );
}

/** For a test, so one case cannot leak into the next. */
export function resetPins(): void {
  write([]);
}
