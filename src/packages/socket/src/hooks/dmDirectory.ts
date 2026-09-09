import type { DirectConversation } from "@gryt/core";
import { useSyncExternalStore } from "react";

/**
 * Every direct conversation, across every connected server. Only the direct
 * messages space needs all of them at once (GRYT-1134).
 */

/** A conversation and the server it belongs to. Never merged across hosts. */
export interface DirectoryEntry {
  host: string;
  conversation: DirectConversation;
}

let byHost = new Map<string, DirectConversation[]>();
let flat: DirectoryEntry[] = [];
const listeners = new Set<() => void>();

/* Rebuilt on write rather than on read: `useSyncExternalStore` compares the
   snapshot by identity, and a fresh array every read is an infinite loop. */
function rebuild() {
  const next: DirectoryEntry[] = [];
  for (const [host, conversations] of byHost) {
    for (const conversation of conversations) next.push({ host, conversation });
  }
  next.sort((a, b) => lastActivity(b.conversation) - lastActivity(a.conversation));
  flat = next;
  for (const listener of listeners) listener();
}

/** When something last happened here, or 0 for a conversation with nothing in it. */
function lastActivity(conversation: DirectConversation): number {
  const at = (conversation as { last_message_at?: string | null }).last_message_at;
  return at ? Date.parse(at) || 0 : 0;
}

/** One server's answer, replacing whatever it said before. */
export function setHostConversations(host: string, conversations: DirectConversation[]): void {
  /* A missing host and a host holding nothing are the same answer, so both take
     the early return. Without the fallback, an empty answer rebuilt every time. */
  if (sameList(byHost.get(host) ?? [], conversations)) return;
  byHost = new Map(byHost);
  if (conversations.length === 0) byHost.delete(host);
  else byHost.set(host, conversations);
  rebuild();
}

/** Dropped on disconnect, so a server that is gone stops contributing rows. */
export function forgetHost(host: string): void {
  if (!byHost.has(host)) return;
  byHost = new Map(byHost);
  byHost.delete(host);
  rebuild();
}

/* Compared by id and activity rather than by reference: the hook hands back a
   new array on every socket event, and rebuilding on each one repaints the list. */
function sameList(a: DirectConversation[], b: DirectConversation[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].conversation_id !== b[i].conversation_id) return false;
    if (lastActivity(a[i]) !== lastActivity(b[i])) return false;
  }
  return true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): DirectoryEntry[] {
  return flat;
}

/** The store as it stands, for a test with no React to render into. */
export function getDirectorySnapshot(): DirectoryEntry[] {
  return flat;
}

/**
 * How many hosts the store is holding. Only a test looks at this: whether an
 * empty host is dropped or kept is invisible in the list either way.
 */
export function directoryHostCount(): number {
  return byHost.size;
}

/** For a test, so one case cannot leak into the next. */
export function resetDirectory(): void {
  byHost = new Map();
  flat = [];
  for (const listener of listeners) listener();
}

/** Newest first, across every server. */
export function useDirectory(): DirectoryEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
