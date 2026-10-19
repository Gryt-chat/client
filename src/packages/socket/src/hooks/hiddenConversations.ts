import type { DirectConversation } from "@gryt/core";
import { useMemo, useSyncExternalStore } from "react";

import type { DirectoryEntry } from "./dmDirectory";

/**
 * Conversations taken out of this device's Messages list. Per device and per
 * account, and never sent anywhere: the server let go of this in GRYT-1379.
 */

const STORAGE_PREFIX = "gryt:hiddenConversations";
const EXPANDED_KEY = `${STORAGE_PREFIX}:expanded`;

/** Conversation id to the moment it was hidden, in epoch milliseconds. */
export type HiddenAt = Readonly<Record<string, number>>;

const EMPTY: HiddenAt = Object.freeze({});

function storageKey(host: string, serverUserId: string): string {
  return `${STORAGE_PREFIX}:${host}:${serverUserId}`;
}

function readStorage(host: string, serverUserId: string): HiddenAt {
  try {
    const raw = localStorage.getItem(storageKey(host, serverUserId));
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY;

    const out: Record<string, number> = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at)) out[id] = at;
    }
    return Object.freeze(out);
  } catch {
    // A private window, or storage somebody cleared under us. Nothing hidden
    // draws every conversation, which is the safe way to be wrong.
    return EMPTY;
  }
}

function writeStorage(host: string, serverUserId: string, hidden: HiddenAt): void {
  try {
    if (Object.keys(hidden).length === 0) {
      localStorage.removeItem(storageKey(host, serverUserId));
      return;
    }
    localStorage.setItem(storageKey(host, serverUserId), JSON.stringify(hidden));
  } catch {
    // Full or unavailable. What was hidden holds for this session and is back
    // next launch, which costs somebody a tidy sidebar and nothing else.
  }
}

/* Keyed by host and account together, so two people sharing a device do not
   share a list, and the same nickname on two servers is still two rows. */
let byAccount: ReadonlyMap<string, HiddenAt> = new Map();
const listeners = new Set<() => void>();

function accountKey(host: string, serverUserId: string): string {
  return JSON.stringify([host, serverUserId]);
}

function emitChange(): void {
  for (const listener of listeners) listener();
}

/** What this account has hidden, read from storage the first time it is asked. */
function load(host: string, serverUserId: string): HiddenAt {
  const key = accountKey(host, serverUserId);
  const held = byAccount.get(key);
  if (held) return held;

  const fromStorage = readStorage(host, serverUserId);
  const next = new Map(byAccount);
  next.set(key, fromStorage);
  byAccount = next;
  return fromStorage;
}

function store(host: string, serverUserId: string, hidden: HiddenAt): void {
  const next = new Map(byAccount);
  next.set(accountKey(host, serverUserId), hidden);
  byAccount = next;
  writeStorage(host, serverUserId, hidden);
  emitChange();
}

/** Takes a conversation out of the list. `at` is only ever passed by a test. */
export function hideConversation(
  host: string,
  serverUserId: string,
  conversationId: string,
  at: number = Date.now(),
): void {
  const held = load(host, serverUserId);
  if (held[conversationId] === at) return;
  store(host, serverUserId, Object.freeze({ ...held, [conversationId]: at }));
}

/** Puts it back, by hand or because a message brought it back. */
export function showConversation(host: string, serverUserId: string, conversationId: string): void {
  const held = load(host, serverUserId);
  if (!(conversationId in held)) return;
  const next = { ...held };
  delete next[conversationId];
  store(host, serverUserId, Object.freeze(next));
}

/** Everything this account has hidden, for a test or for a render. */
export function hiddenFor(host: string, serverUserId: string): HiddenAt {
  return load(host, serverUserId);
}

/**
 * Whether a message landed after it was hidden, read off the list the server
 * already sends. Clamped to now, or a clock that went back hides it for good.
 */
export function isBackFromHiding(
  hiddenAt: number,
  lastMessageAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastMessageAt) return false;
  const wrote = Date.parse(lastMessageAt);
  if (Number.isNaN(wrote)) return false;
  return wrote > Math.min(hiddenAt, now);
}

/** Whether this device is holding this conversation back at the moment. */
export function isHiddenConversation(
  host: string,
  serverUserId: string,
  conversation: DirectConversation,
  now: number = Date.now(),
): boolean {
  const at = load(host, serverUserId)[conversation.conversation_id];
  if (at === undefined) return false;
  return !isBackFromHiding(at, lastMessageAt(conversation), now);
}

export interface SplitConversations {
  /** The rows the list draws, in the order they came in. */
  listed: DirectoryEntry[];
  /** The rows under the Hidden toggle, same order. */
  hidden: DirectoryEntry[];
  /** Hidden ones a message brought back. Their stored entries can go. */
  returned: DirectoryEntry[];
}

/**
 * Splits what the directory holds into the two lists. Pure, so the ones that
 * came back are forgotten in an effect rather than during a render.
 */
export function splitHidden(
  entries: DirectoryEntry[],
  hiddenAtFor: (host: string) => HiddenAt,
  now: number = Date.now(),
): SplitConversations {
  const listed: DirectoryEntry[] = [];
  const hidden: DirectoryEntry[] = [];
  const returned: DirectoryEntry[] = [];

  for (const entry of entries) {
    const at = hiddenAtFor(entry.host)[entry.conversation.conversation_id];
    if (at === undefined) {
      listed.push(entry);
      continue;
    }
    if (isBackFromHiding(at, lastMessageAt(entry.conversation), now)) {
      listed.push(entry);
      returned.push(entry);
      continue;
    }
    hidden.push(entry);
  }

  return { listed, hidden, returned };
}

function lastMessageAt(conversation: DirectConversation): string | null {
  return (conversation as { last_message_at?: string | null }).last_message_at ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadonlyMap<string, HiddenAt> {
  return byAccount;
}

/**
 * What each account has hidden, as a lookup that changes identity whenever
 * something is hidden or put back, so a list drawn from it redraws.
 */
export function useHiddenConversations(): (host: string, serverUserId: string) => HiddenAt {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () => (host: string, serverUserId: string) =>
      snapshot.get(accountKey(host, serverUserId)) ?? load(host, serverUserId),
    [snapshot],
  );
}

/** For a test, so one case cannot leak into the next. */
export function resetHiddenConversations(): void {
  byAccount = new Map();
  emitChange();
}

/* Whether the Hidden group is open. One answer for the device rather than one
   per server: it is a row in one list that spans every server. */
let expanded = readExpanded();
const expandedListeners = new Set<() => void>();

function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setHiddenExpanded(open: boolean): void {
  if (expanded === open) return;
  expanded = open;
  try {
    localStorage.setItem(EXPANDED_KEY, open ? "1" : "0");
  } catch {
    // Same as above: it holds for this session and forgets on the next launch.
  }
  for (const listener of expandedListeners) listener();
}

export function useHiddenExpanded(): boolean {
  return useSyncExternalStore(
    (listener) => {
      expandedListeners.add(listener);
      return () => {
        expandedListeners.delete(listener);
      };
    },
    () => expanded,
    () => expanded,
  );
}
