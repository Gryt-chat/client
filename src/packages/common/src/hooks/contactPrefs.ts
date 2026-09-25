/**
 * Who may message or ring you (GRYT-1470): one answer for every server, and an
 * override per server. Kept on this device, and written to each server on connect.
 */

/** "friends" means people you've written to in a one-to-one, until GRYT-1471. */
export type ContactRule = "everyone" | "friends" | "nobody";

export interface ContactPrefs {
  messages: ContactRule;
  calls: ContactRule;
}

/** Either half left out follows the global answer. */
export type ContactOverride = Partial<ContactPrefs>;

export interface StoredContactPrefs {
  global: ContactPrefs;
  servers: Record<string, ContactOverride>;
}

/** Sivert's defaults, 2026-09-24. The server holds the same pair. */
export const DEFAULT_CONTACT_PREFS: ContactPrefs = { messages: "everyone", calls: "friends" };

const STORAGE_KEY = "gryt_contact_prefs";

export function isContactRule(value: unknown): value is ContactRule {
  return value === "everyone" || value === "friends" || value === "nobody";
}

/** How loose a rule is, so the call rule can be held under the message rule. */
const LOOSENESS: Record<ContactRule, number> = { everyone: 2, friends: 1, nobody: 0 };

export function stricterOf(a: ContactRule, b: ContactRule): ContactRule {
  return LOOSENESS[a] <= LOOSENESS[b] ? a : b;
}

/** Anything unreadable falls back to the defaults, per half. */
export function parseStoredContactPrefs(raw: unknown): StoredContactPrefs {
  const out: StoredContactPrefs = { global: { ...DEFAULT_CONTACT_PREFS }, servers: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const outer = raw as Record<string, unknown>;

  const global = outer.global as Record<string, unknown> | undefined;
  if (global && typeof global === "object") {
    if (isContactRule(global.messages)) out.global.messages = global.messages;
    if (isContactRule(global.calls)) out.global.calls = global.calls;
  }

  const servers = outer.servers;
  if (servers && typeof servers === "object" && !Array.isArray(servers)) {
    for (const [host, value] of Object.entries(servers as Record<string, unknown>)) {
      if (!host || !value || typeof value !== "object") continue;
      const scope = value as Record<string, unknown>;
      const entry: ContactOverride = {};
      if (isContactRule(scope.messages)) entry.messages = scope.messages;
      if (isContactRule(scope.calls)) entry.calls = scope.calls;
      if (entry.messages || entry.calls) out.servers[host] = entry;
    }
  }
  return out;
}

/** What a server is told and what this device checks against. Calls are never
    looser than messages, since a ring happens inside a conversation. */
export function resolveContactPrefs(stored: StoredContactPrefs, host: string): ContactPrefs {
  const own = stored.servers[host] ?? {};
  const messages = own.messages ?? stored.global.messages;
  const calls = own.calls ?? stored.global.calls;
  return { messages, calls: stricterOf(calls, messages) };
}

// ── The store, module scope like notificationPrefs next door ────────────────

let stored: StoredContactPrefs = load();
const listeners = new Set<() => void>();

function load(): StoredContactPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return parseStoredContactPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return parseStoredContactPrefs(null);
  }
}

function commit(next: StoredContactPrefs): void {
  stored = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode or a full quota: it holds for this session.
  }
  for (const listener of listeners) listener();
}

export function subscribeToContactPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getContactPrefsSnapshot(): StoredContactPrefs {
  return stored;
}

export function effectiveContactPrefs(host: string): ContactPrefs {
  return resolveContactPrefs(stored, host);
}

export function setGlobalContactRule(kind: keyof ContactPrefs, rule: ContactRule): void {
  if (stored.global[kind] === rule) return;
  commit({ ...stored, global: { ...stored.global, [kind]: rule } });
}

/** Null clears the override, so this server follows the global answer again. */
export function setServerContactRule(host: string, kind: keyof ContactPrefs, rule: ContactRule | null): void {
  const entry: ContactOverride = { ...(stored.servers[host] ?? {}) };
  if (rule) entry[kind] = rule;
  else delete entry[kind];
  const servers = { ...stored.servers };
  if (entry.messages || entry.calls) servers[host] = entry;
  else delete servers[host];
  commit({ ...stored, servers });
}
