import { useSyncExternalStore } from "react";

import { type ContactKnowledge, emptyKnowledge, type FilteredEvent } from "../utils/contactFilter";

/**
 * What the contact guard knows per server, and what it has held back. Both on
 * this device only (GRYT-1470).
 */

const KNOWLEDGE_KEY = "gryt_contact_knowledge";
const FILTERED_KEY = "gryt_contact_filtered";
/* Enough for anybody's real conversations; the cap only stops a flood growing it. */
const MAX_IDS = 2000;
const MAX_FILTERED = 100;

/* `friends` is what GRYT-1470 called wroteTo, read so nothing is lost on the way. */
type StoredKnowledge = Record<string, { wroteTo?: string[]; friends?: string[]; known?: string[]; baselined?: boolean }>;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // It holds for this session.
  }
}

const knowledge = new Map<string, ContactKnowledge>();

export function knowledgeFor(host: string): ContactKnowledge {
  let k = knowledge.get(host);
  if (k) return k;
  const saved = read<StoredKnowledge>(KNOWLEDGE_KEY, {})[host];
  k = emptyKnowledge();
  for (const id of strings(saved?.wroteTo ?? saved?.friends)) k.wroteTo.add(id);
  for (const id of strings(saved?.known)) k.known.add(id);
  k.baselined = saved?.baselined === true;
  knowledge.set(host, k);
  return k;
}

/** The newest ids are kept when a set outgrows its cap. */
export function persistKnowledge(host: string): void {
  const k = knowledge.get(host);
  if (!k) return;
  const all = read<StoredKnowledge>(KNOWLEDGE_KEY, {});
  all[host] = {
    wroteTo: [...k.wroteTo].slice(-MAX_IDS),
    known: [...k.known].slice(-MAX_IDS),
    baselined: k.baselined,
  };
  write(KNOWLEDGE_KEY, all);
}

/** You opened something that was held back, so the guard lets that conversation in. */
export function admitConversation(host: string, conversationId: string): void {
  knowledgeFor(host).known.add(conversationId);
  persistKnowledge(host);
}

/** One row per conversation and kind, counted, so a flood is one line and a number. */
export interface FilteredItem {
  host: string;
  conversationId: string;
  kind: FilteredEvent["kind"];
  reason: FilteredEvent["reason"];
  fromId: string | null;
  fromName: string | null;
  count: number;
  lastAt: number;
}

let filtered: FilteredItem[] = read<FilteredItem[]>(FILTERED_KEY, []).filter(
  (f) => f && typeof f.host === "string" && typeof f.count === "number",
);
const listeners = new Set<() => void>();

function commit(next: FilteredItem[]): void {
  filtered = next;
  write(FILTERED_KEY, filtered);
  for (const listener of listeners) listener();
}

/** What they did, in a few words. */
export function filteredSummary(item: FilteredItem): string {
  const times = item.count === 1 ? "" : ` ${item.count} times`;
  const what =
    item.kind === "call" ? `Called you${times}`
      : item.kind === "conversation" ? "Started a conversation"
        : item.count === 1 ? "Sent a message" : `Sent ${item.count} messages`;
  return item.reason === "flood" ? `${what}, in a burst` : what;
}

/** A conversation and its messages are one row, and a call is its own. */
function rowKind(kind: FilteredEvent["kind"]): "call" | "message" {
  return kind === "call" ? "call" : "message";
}

export function recordFiltered(event: FilteredEvent): void {
  const same = (f: FilteredItem) =>
    f.host === event.host && f.conversationId === event.conversationId && rowKind(f.kind) === rowKind(event.kind);
  const prev = filtered.find(same);
  // The conversation arriving adds no message to the count; its first message does.
  const opened = event.kind === "conversation";
  const kind = opened ? (prev?.kind ?? "conversation") : event.kind;
  const count = opened ? (prev?.count ?? 1) : prev?.kind === "conversation" ? 1 : (prev?.count ?? 0) + 1;
  const item: FilteredItem = {
    host: event.host,
    conversationId: event.conversationId,
    kind,
    reason: event.reason,
    fromId: event.fromId ?? prev?.fromId ?? null,
    fromName: event.fromName ?? prev?.fromName ?? null,
    count,
    lastAt: event.at,
  };
  commit([item, ...filtered.filter((f) => !same(f))].slice(0, MAX_FILTERED));
}

export function clearFiltered(): void {
  commit([]);
}

/** Take one out, when somebody has opened it. */
export function dismissFiltered(host: string, conversationId: string): void {
  commit(filtered.filter((f) => !(f.host === host && f.conversationId === conversationId)));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFilteredContacts(): FilteredItem[] {
  return useSyncExternalStore(subscribe, () => filtered, () => filtered);
}
