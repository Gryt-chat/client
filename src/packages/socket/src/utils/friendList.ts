import type { ContactPrefs } from "../../../common/src/hooks/contactPrefs.ts";
import { createFloodLimiter } from "./contactFilter.ts";

/**
 * Your friends on one server, as this device knows them (GRYT-1471). Only here,
 * never on an account. The server's word adds nobody you didn't say yes to.
 */

export interface FriendEntry {
  nickname: string | null;
  since: number;
}

export interface FriendBook {
  friends: Map<string, FriendEntry>;
  /** People this device asked, or accepted, and when. The server hasn't paired them yet. */
  asked: Map<string, number>;
}

/** A list already on its way when you asked can't take the ask back. */
const ASK_GRACE_MS = 30_000;

export function emptyBook(): FriendBook {
  return { friends: new Map(), asked: new Map() };
}

export interface ServerFriendPerson {
  serverUserId: string;
  nickname: string | null;
  at: string;
}

/** What `friend:list` carries. */
export interface ServerFriendList {
  friends: ServerFriendPerson[];
  incoming: ServerFriendPerson[];
  outgoing: ServerFriendPerson[];
}

const PERSON = (v: unknown): v is ServerFriendPerson =>
  !!v && typeof v === "object" && typeof (v as ServerFriendPerson).serverUserId === "string";

/** Anything malformed reads as empty rather than throwing inside a socket handler. */
export function parseFriendList(v: unknown): ServerFriendList | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const people = (x: unknown) => (Array.isArray(x) ? x.filter(PERSON) : []);
  return { friends: people(r.friends), incoming: people(r.incoming), outgoing: people(r.outgoing) };
}

/**
 * The server's list against the book. A removal is always believed, since it only
 * makes things stricter. A friendship is added only for somebody this device asked.
 */
export function reconcile(book: FriendBook, list: ServerFriendList, now = Date.now()): boolean {
  let changed = false;
  const onServer = new Map(list.friends.map((p) => [p.serverUserId, p]));
  for (const id of [...book.friends.keys()]) {
    if (!onServer.has(id)) {
      book.friends.delete(id);
      changed = true;
    }
  }
  for (const [id, p] of onServer) {
    if (book.asked.has(id)) {
      book.friends.set(id, { nickname: p.nickname, since: Date.parse(p.at) || now });
      book.asked.delete(id);
      changed = true;
    } else if (book.friends.has(id) && p.nickname && book.friends.get(id)?.nickname !== p.nickname) {
      book.friends.set(id, { ...book.friends.get(id)!, nickname: p.nickname });
      changed = true;
    }
  }
  const pending = new Set([...list.incoming, ...list.outgoing].map((p) => p.serverUserId));
  for (const [id, at] of [...book.asked]) {
    if (!pending.has(id) && !onServer.has(id) && now - at > ASK_GRACE_MS) {
      book.asked.delete(id);
      changed = true;
    }
  }
  return changed;
}

/** Friends the server lists that this device never agreed to, for you to confirm by hand. */
export function unconfirmed(book: FriendBook, list: ServerFriendList | null): ServerFriendPerson[] {
  return (list?.friends ?? []).filter((p) => !book.friends.has(p.serverUserId));
}

/** You confirmed one the server listed, from another device or before this one. */
export function confirmFriend(book: FriendBook, person: ServerFriendPerson, now = Date.now()): void {
  book.friends.set(person.serverUserId, { nickname: person.nickname, since: Date.parse(person.at) || now });
}

export type FriendState = "friend" | "unconfirmed" | "incoming" | "outgoing" | "none";

export function friendState(book: FriendBook, list: ServerFriendList | null, id: string): FriendState {
  if (book.friends.has(id)) return "friend";
  if (!list) return "none";
  if (list.friends.some((p) => p.serverUserId === id)) return "unconfirmed";
  if (list.incoming.some((p) => p.serverUserId === id)) return "incoming";
  if (list.outgoing.some((p) => p.serverUserId === id)) return "outgoing";
  return "none";
}

interface SocketInternals {
  onevent: (packet: { data?: unknown[] }) => void;
  emit: (event: string, ...args: unknown[]) => unknown;
}

export interface FriendWatchDeps {
  book: FriendBook;
  prefs: () => ContactPrefs;
  persist: () => void;
  limiter?: { admit(now: number): boolean };
  now?: () => number;
}

/**
 * Keeps the book in step with what you do and what the server says, on one socket.
 * Install before `guardSocket`, like the contact guard.
 */
export function watchFriendTraffic(socket: unknown, deps: FriendWatchDeps): void {
  const s = socket as SocketInternals;
  const { book } = deps;
  const now = deps.now ?? (() => Date.now());
  const limiter = deps.limiter ?? createFloodLimiter();

  /** True to deliver. A request notice is held back where your settings would refuse it. */
  function inbound(event: string, payload: unknown): boolean {
    if (event === "friend:list") {
      const list = parseFriendList(payload);
      if (list && reconcile(book, list, now())) deps.persist();
      return true;
    }
    if (event === "friend:request:incoming") {
      if (deps.prefs().messages === "nobody") return false;
      return limiter.admit(now());
    }
    return true;
  }

  function outbound(event: string, payload: unknown): void {
    const id = payload && typeof payload === "object" ? (payload as { serverUserId?: unknown }).serverUserId : null;
    if (typeof id !== "string" || !id) return;
    if (event === "friend:request" || event === "friend:accept") {
      book.asked.set(id, now());
    } else if (event === "friend:remove" || event === "friend:cancel") {
      book.friends.delete(id);
      book.asked.delete(id);
    } else if (event === "user:block") {
      book.friends.delete(id);
      book.asked.delete(id);
    } else {
      return;
    }
    deps.persist();
  }

  const onevent = s.onevent.bind(socket);
  s.onevent = (packet) => {
    const args = packet?.data;
    if (Array.isArray(args) && typeof args[0] === "string" && !inbound(args[0], args[1])) return;
    onevent(packet);
  };

  const emit = s.emit.bind(socket);
  s.emit = (event: string, ...args: unknown[]) => {
    try {
      outbound(event, args[0]);
    } catch {
      // The book is a record; the send itself must never fail on it.
    }
    return emit(event, ...args);
  };
}
