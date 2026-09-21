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
  next.sort(newestFirst);
  flat = next;
  for (const listener of listeners) listener();
}

/* Ties go by server and id rather than by arrival, which moves whenever a host
   drops out and answers again. */
function newestFirst(a: DirectoryEntry, b: DirectoryEntry): number {
  return lastActivity(b.conversation) - lastActivity(a.conversation)
    || compare(a.host, b.host)
    || compare(a.conversation.conversation_id, b.conversation.conversation_id);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The rows the space lists, newest message first. An empty conversation shows only
 * while it is the open one, and then on top, since that is where you are.
 */
export function listedConversations(entries: DirectoryEntry[], visiting: string | null): DirectoryEntry[] {
  const open: DirectoryEntry[] = [];
  const written: DirectoryEntry[] = [];
  for (const entry of entries) {
    /* A group is listed from the start, as the server lists it. Hidden, nobody
       could open it to write the first message. */
    if (entry.conversation.last_message_at !== null || entry.conversation.kind === "group") written.push(entry);
    else if (entry.conversation.conversation_id === visiting) open.push(entry);
  }
  return [...open, ...written.sort(newestFirst)];
}

/** When something last happened here: the last message, else when it was made. */
function lastActivity(conversation: DirectConversation): number {
  const { last_message_at: at, created_at: made } = conversation as {
    last_message_at?: string | null;
    created_at?: string;
  };
  const when = at ?? made;
  return when ? Date.parse(when) || 0 : 0;
}

/* Servers that said they take no new conversations, so the new-message dialog
   can leave their people out. A separate snapshot: the rows do not change. */
let dmsOff: ReadonlySet<string> = new Set();
const dmsOffListeners = new Set<() => void>();

export function setHostDmsOff(host: string, off: boolean): void {
  if (dmsOff.has(host) === off) return;
  const next = new Set(dmsOff);
  if (off) next.add(host);
  else next.delete(host);
  dmsOff = next;
  for (const listener of dmsOffListeners) listener();
}

/** Hosts that turned direct messages off, per the last thing each one said. */
export function useDmsOffHosts(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      dmsOffListeners.add(listener);
      return () => dmsOffListeners.delete(listener);
    },
    () => dmsOff,
    () => dmsOff,
  );
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

/* Compared by what a row draws rather than by reference: the hook hands back a
   new array on every socket event, and rebuilding on each one repaints the list. */
function sameList(a: DirectConversation[], b: DirectConversation[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].conversation_id !== b[i].conversation_id) return false;
    if (lastActivity(a[i]) !== lastActivity(b[i])) return false;
    if (face(a[i]) !== face(b[i])) return false;
  }
  return true;
}

/* A group renamed, repictured or joined arrives with its id and activity unchanged,
   so those alone left the old name on the row. */
function face(conversation: DirectConversation): string {
  const { name, icon_file_id: icon, members } = conversation as Partial<DirectConversation>;
  const people = (members ?? [])
    .map((m) => `${m.server_user_id}:${m.nickname}:${m.avatar_file_id ?? ""}:${m.avatar_worn ?? ""}`)
    .join(",");
  return `${name ?? ""}|${icon ?? ""}|${people}`;
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
  dmsOff = new Set();
  for (const listener of listeners) listener();
}

/** Newest first, across every server. */
export function useDirectory(): DirectoryEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
