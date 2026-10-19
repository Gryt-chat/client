import { useSyncExternalStore } from "react";

import { FAKE_CONFIRMED, fakeFriendList, isFakeHost, onFakeHostClaimed } from "../dev/fakeDms.ts";
import type { FriendGate } from "../utils/contactFilter.ts";
import {
  confirmFriend,
  emptyBook,
  type FriendBook,
  type FriendState,
  friendState,
  type ServerFriendList,
  type ServerFriendPerson,
  unconfirmed,
} from "../utils/friendList.ts";

/**
 * Your friends per server (GRYT-1471). The book is this device's own, kept in
 * localStorage and nowhere else. The server's list is only held for the session.
 */

const BOOK_KEY = "gryt_friends";
/* A request is announced once per device, however often the server says it again. */
const MAX_NOTIFIED = 500;

type StoredBook = Record<string, { friends?: Record<string, { nickname?: unknown; since?: unknown }>; asked?: Record<string, unknown>; notified?: unknown }>;

function read(): StoredBook {
  try {
    const raw = localStorage.getItem(BOOK_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as StoredBook) : {};
  } catch {
    return {};
  }
}

const books = new Map<string, FriendBook>();
const notified = new Map<string, Set<string>>();
const lists = new Map<string, ServerFriendList>();
const emitters = new Map<string, (event: string, serverUserId: string) => void>();
const listeners = new Set<() => void>();
// `?fakedms`: the boards' friends, whether or not the server sends a list of its own.
onFakeHostClaimed((host) => setServerFriendList(host, lists.get(host) ?? { friends: [], incoming: [], outgoing: [] }));
let version = 0;

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function friendBookFor(host: string): FriendBook {
  let book = books.get(host);
  if (book) return book;
  book = emptyBook();
  const saved = read()[host];
  for (const [id, e] of Object.entries(saved?.friends ?? {})) {
    book.friends.set(id, { nickname: typeof e?.nickname === "string" ? e.nickname : null, since: Number(e?.since) || 0 });
  }
  for (const [id, at] of Object.entries(saved?.asked ?? {})) book.asked.set(id, Number(at) || 0);
  notified.set(host, new Set(Array.isArray(saved?.notified) ? saved.notified.filter((x): x is string => typeof x === "string") : []));
  books.set(host, book);
  return book;
}

export function persistFriendBook(host: string): void {
  const book = friendBookFor(host);
  const all = read();
  all[host] = {
    friends: Object.fromEntries([...book.friends].map(([id, e]) => [id, { nickname: e.nickname, since: e.since }])),
    asked: Object.fromEntries(book.asked),
    notified: [...(notified.get(host) ?? [])].slice(-MAX_NOTIFIED),
  };
  try {
    localStorage.setItem(BOOK_KEY, JSON.stringify(all));
  } catch {
    // It holds for this session.
  }
  changed();
}

/** What the contact guard asks, straight from the book. */
export function friendGateFor(host: string): FriendGate {
  return {
    isFriend: (id) => friendBookFor(host).friends.has(id),
    hasAny: () => friendBookFor(host).friends.size > 0,
  };
}

export function setServerFriendList(host: string, real: ServerFriendList): void {
  let list = real;
  if (isFakeHost(host)) {
    const fake = fakeFriendList();
    list = { friends: [...real.friends, ...fake.friends], incoming: [...real.incoming, ...fake.incoming], outgoing: real.outgoing };
    // Held in memory only, so a fake never lands in this device's real book.
    for (const id of FAKE_CONFIRMED) friendBookFor(host).friends.set(id, { nickname: null, since: 1 });
  }
  lists.set(host, list);
  changed();
}

export function forgetServerFriendList(host: string): void {
  if (lists.delete(host)) changed();
}

/** True the first time this device hears about a request from them. */
export function firstNoticeOf(host: string, serverUserId: string): boolean {
  friendBookFor(host);
  const seen = notified.get(host) ?? new Set<string>();
  notified.set(host, seen);
  if (seen.has(serverUserId)) return false;
  seen.add(serverUserId);
  persistFriendBook(host);
  return true;
}

export function registerFriendEmitter(host: string, emit: ((event: string, serverUserId: string) => void) | null): void {
  if (emit) emitters.set(host, emit);
  else emitters.delete(host);
}

export type FriendAction = "request" | "accept" | "decline" | "cancel" | "remove";

export function friendAction(host: string, action: FriendAction, serverUserId: string): void {
  emitters.get(host)?.(`friend:${action}`, serverUserId);
}

export function confirmServerFriend(host: string, person: ServerFriendPerson): void {
  confirmFriend(friendBookFor(host), person);
  persistFriendBook(host);
}

export interface HostFriends {
  host: string;
  friends: (ServerFriendPerson & { confirmed: boolean })[];
  incoming: ServerFriendPerson[];
  outgoing: ServerFriendPerson[];
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): number {
  return version;
}

function hostFriends(host: string): HostFriends | null {
  const list = lists.get(host);
  if (!list) return null;
  const book = friendBookFor(host);
  const pending = new Set(unconfirmed(book, list).map((p) => p.serverUserId));
  return {
    host,
    friends: list.friends.map((p) => ({ ...p, confirmed: !pending.has(p.serverUserId) })),
    incoming: list.incoming,
    outgoing: list.outgoing,
  };
}

/** Every server that answered `friend:list`. One from before GRYT-1471 never does. */
export function useAllFriends(): HostFriends[] {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return [...lists.keys()].map(hostFriends).filter((h): h is HostFriends => !!h);
}

/** Where you stand with one person, or null when the server has no friends at all. */
export function useFriendState(host: string | undefined, serverUserId: string | undefined): FriendState | null {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  if (!host || !serverUserId || !lists.has(host)) return null;
  return friendState(friendBookFor(host), lists.get(host) ?? null, serverUserId);
}

export function useIncomingFriendCount(): number {
  return useAllFriends().reduce((n, h) => n + h.incoming.length, 0);
}
