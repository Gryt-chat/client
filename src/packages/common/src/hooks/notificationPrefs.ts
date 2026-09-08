/**
 * How loud each server, folder and channel is, on this device. **Local, and never
 * sent anywhere**; most-specific-wins, under a global level that can only quieten.
 */

export type NotificationLevel = "all" | "mentions" | "none";

/** What a scope says, or absent to take the answer from the level above. */
export interface ServerNotificationPrefs {
  server?: NotificationLevel;
  folders?: Record<string, NotificationLevel>;
  channels?: Record<string, NotificationLevel>;
}

export type NotificationPrefs = Record<string, ServerNotificationPrefs>;

/** Everything this device has decided: the ceiling, and the per-server rules. */
export interface StoredNotificationPrefs {
  global: NotificationLevel;
  servers: NotificationPrefs;
}

/** Loudest to quietest, so two levels can be compared. */
const LOUDNESS: Record<NotificationLevel, number> = {
  all: 2,
  mentions: 1,
  none: 0,
};

/** The quieter of two levels. The global ceiling is applied with this. */
export function quieterOf(
  a: NotificationLevel,
  b: NotificationLevel,
): NotificationLevel {
  return LOUDNESS[a] <= LOUDNESS[b] ? a : b;
}

/**
 * Whether the global level is the one actually deciding here. The menus say so:
 * a channel reading "Everything" and making no sound is a bug report waiting.
 */
export function globalOverrules(
  global: NotificationLevel,
  resolved: NotificationLevel,
): boolean {
  return LOUDNESS[global] < LOUDNESS[resolved];
}

/** Only what the resolver needs, so it can be tested without a sidebar. */
export interface ChannelPlacement {
  channelId: string;
  parentItemId?: string | null;
}

const STORAGE_KEY = "gryt_notification_prefs";

const isLevel = (v: unknown): v is NotificationLevel =>
  v === "all" || v === "mentions" || v === "none";

/**
 * Reads what is stored, dropping anything unrecognised. Failing to "all" rather
 * than to silence: hearing nothing looks exactly like a quiet day.
 */
export function parsePrefs(raw: unknown): NotificationPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const out: NotificationPrefs = {};
  for (const [host, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!host || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const scope = value as Record<string, unknown>;
    const entry: ServerNotificationPrefs = {};

    if (isLevel(scope.server)) entry.server = scope.server;

    for (const key of ["folders", "channels"] as const) {
      const bag = scope[key];
      if (!bag || typeof bag !== "object" || Array.isArray(bag)) continue;
      const kept: Record<string, NotificationLevel> = {};
      for (const [id, level] of Object.entries(bag as Record<string, unknown>)) {
        if (id && isLevel(level)) kept[id] = level;
      }
      if (Object.keys(kept).length > 0) entry[key] = kept;
    }

    if (entry.server || entry.folders || entry.channels) out[host] = entry;
  }
  return out;
}

/**
 * The whole file, in either shape it has been written in. Anything without a
 * `servers` object is read as the old flat map, which no host can be taken for.
 */
export function parseStored(raw: unknown): StoredNotificationPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { global: "all", servers: {} };
  }

  const outer = raw as Record<string, unknown>;
  const nested = outer.servers;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return {
      global: isLevel(outer.global) ? outer.global : "all",
      servers: parsePrefs(nested),
    };
  }

  return { global: "all", servers: parsePrefs(raw) };
}

/**
 * What this channel is set to, following the most specific answer there is. A
 * channel in no folder skips that step rather than treating it as a scope.
 */
export function resolveLevel(
  prefs: NotificationPrefs,
  host: string,
  placement: ChannelPlacement | null,
): NotificationLevel {
  const scope = prefs[host];
  if (!scope) return "all";

  if (placement) {
    const own = scope.channels?.[placement.channelId];
    if (own) return own;

    const parent = placement.parentItemId;
    if (parent) {
      const folder = scope.folders?.[parent];
      if (folder) return folder;
    }
  }

  return scope.server ?? "all";
}

/** Whether a plain message in this channel should make any noise. */
export function shouldAnnounceMessage(level: NotificationLevel): boolean {
  return level === "all";
}

/** Whether being named in this channel should. */
export function shouldAnnounceMention(level: NotificationLevel): boolean {
  return level === "all" || level === "mentions";
}

// ── The store ───────────────────────────────────────────────────────────────
//
// Module scope and useSyncExternalStore, like the mention tracker next door, so
// the sidebar reaches the socket layer without either holding a reference.

let stored: StoredNotificationPrefs = load();
const listeners = new Set<() => void>();

function load(): StoredNotificationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return parseStored(raw ? JSON.parse(raw) : null);
  } catch {
    // Unreadable is the same as unset, which is hearing everything.
    return { global: "all", servers: {} };
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode or a full quota. The setting holds for this session and is
    // gone next launch, which is the safe way to lose it.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToPrefs(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPrefsSnapshot(): NotificationPrefs {
  return stored.servers;
}

/**
 * Both halves, as one object replaced on every write. `useSyncExternalStore` bails
 * on an identical snapshot, so watching only the servers map misses the global.
 */
export function getStoredSnapshot(): StoredNotificationPrefs {
  return stored;
}

export function getGlobalLevel(): NotificationLevel {
  return stored.global;
}

/** The ceiling over every server. "all" is the same as having none. */
export function setGlobalLevel(level: NotificationLevel) {
  if (stored.global === level) return;
  stored = { ...stored, global: level };
  persist();
  emit();
}

/**
 * What a channel is actually set to once the ceiling is applied. `resolveLevel`
 * on its own is the per-server half of it.
 */
export function resolveAnnounceLevel(
  host: string,
  placement: ChannelPlacement | null,
): NotificationLevel {
  return quieterOf(stored.global, resolveLevel(stored.servers, host, placement));
}

/**
 * Set one scope, or clear it by passing null so it inherits again. Clearing is not
 * the same as "all": a cleared channel follows its folder, an "all" one does not.
 */
export function setNotificationLevel(
  host: string,
  scope: { kind: "server" } | { kind: "folder" | "channel"; id: string },
  level: NotificationLevel | null,
) {
  const next: NotificationPrefs = { ...stored.servers };
  const entry: ServerNotificationPrefs = { ...(next[host] ?? {}) };

  if (scope.kind === "server") {
    if (level) entry.server = level;
    else delete entry.server;
  } else {
    const key = scope.kind === "folder" ? "folders" : "channels";
    const bag = { ...(entry[key] ?? {}) };
    if (level) bag[scope.id] = level;
    else delete bag[scope.id];
    if (Object.keys(bag).length > 0) entry[key] = bag;
    else delete entry[key];
  }

  if (entry.server || entry.folders || entry.channels) next[host] = entry;
  else delete next[host];

  stored = { ...stored, servers: next };
  persist();
  emit();
}

// ── Where each channel sits ─────────────────────────────────────────────────
//
// The socket layer deciding whether to make a noise has no sidebar, so placement
// is recorded as `server:details` arrives. Not persisted: a stale copy would lie.

let placements: Record<string, Record<string, ChannelPlacement>> = {};

/** Take the channel-to-folder map out of a fresh `server:details`. */
export function rememberPlacements(
  host: string,
  items: { kind?: string; channelId?: string | null; parentItemId?: string | null }[],
) {
  const byChannel: Record<string, ChannelPlacement> = {};
  for (const item of items) {
    if (item.kind !== "channel" || !item.channelId) continue;
    byChannel[item.channelId] = {
      channelId: item.channelId,
      parentItemId: item.parentItemId ?? null,
    };
  }
  placements = { ...placements, [host]: byChannel };
}

/**
 * Where a channel sits, or null if this client has not seen a sidebar naming it.
 * Null resolves to the server level.
 */
export function getPlacement(host: string, channelId: string): ChannelPlacement | null {
  return placements[host]?.[channelId] ?? null;
}

/** What a scope is set to outright, ignoring anything it would inherit. */
export function getOwnLevel(
  host: string,
  scope: { kind: "server" } | { kind: "folder" | "channel"; id: string },
): NotificationLevel | null {
  const entry = stored.servers[host];
  if (!entry) return null;
  if (scope.kind === "server") return entry.server ?? null;
  const bag = scope.kind === "folder" ? entry.folders : entry.channels;
  return bag?.[scope.id] ?? null;
}
