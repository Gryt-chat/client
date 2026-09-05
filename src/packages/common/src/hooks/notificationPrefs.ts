/**
 * How loud each server, folder and channel is, on this device.
 *
 * **Local, and deliberately never sent anywhere.** A list of the channels
 * somebody has muted is a list of what they are avoiding, and the server has no
 * use for it: every notification this gates is produced by the client, from
 * events the server was going to send regardless. Keeping it here means muting
 * a channel tells nobody that you did.
 *
 * The cost is honest and worth stating: it does not follow you to another
 * machine or to the phone. Each device is set up once.
 *
 * Resolution is most-specific-wins. A channel's own setting beats its folder's,
 * which beats the server's, which falls back to hearing everything. Muting a
 * server therefore quietens it without deciding for a channel somebody has
 * already had an opinion about.
 */

export type NotificationLevel = "all" | "mentions" | "none";

/** What a scope says, or absent to take the answer from the level above. */
export interface ServerNotificationPrefs {
  server?: NotificationLevel;
  folders?: Record<string, NotificationLevel>;
  channels?: Record<string, NotificationLevel>;
}

export type NotificationPrefs = Record<string, ServerNotificationPrefs>;

/** Only what the resolver needs, so it can be tested without a sidebar. */
export interface ChannelPlacement {
  channelId: string;
  parentItemId?: string | null;
}

const STORAGE_KEY = "gryt_notification_prefs";

const isLevel = (v: unknown): v is NotificationLevel =>
  v === "all" || v === "mentions" || v === "none";

/**
 * Reads what is stored, dropping anything unrecognised.
 *
 * Failing to "all" rather than to silence is deliberate. A corrupted file
 * should leave somebody hearing too much, which they will notice and can fix,
 * rather than hearing nothing, which looks exactly like a quiet day.
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
 * What this channel is set to, following the most specific answer there is.
 *
 * `placement` is where the channel sits, which is the only reason the folder
 * level can be consulted at all. A channel in no folder skips that step rather
 * than treating "no folder" as a scope of its own.
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
// Module scope and useSyncExternalStore, the same shape as the mention tracker
// next door, so a change made in the sidebar reaches the socket layer without
// either one holding a reference to the other.

let prefs: NotificationPrefs = load();
const listeners = new Set<() => void>();

function load(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return parsePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    // Unreadable is the same as unset, which is hearing everything.
    return {};
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
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
  return prefs;
}

/**
 * Set one scope, or clear it by passing null so it inherits again.
 *
 * Clearing is a real answer rather than the same thing as "all": a channel set
 * back to default follows its folder afterwards, and a channel set to "all"
 * stops following it.
 */
export function setNotificationLevel(
  host: string,
  scope: { kind: "server" } | { kind: "folder" | "channel"; id: string },
  level: NotificationLevel | null,
) {
  const next: NotificationPrefs = { ...prefs };
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

  prefs = next;
  persist();
  emit();
}

// ── Where each channel sits ─────────────────────────────────────────────────
//
// The folder level can only be consulted if something knows which folder a
// channel is in, and the socket layer that decides whether to make a noise has
// no sidebar. Rather than thread the whole `serverDetailsList` down to it, the
// placement is recorded as `server:details` arrives and read back here.
//
// Not persisted. It is a copy of what the server just said, and a stale copy
// read at launch would put a channel in a folder that had been deleted.

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
 * Where a channel sits, or null if this client has not seen a sidebar naming
 * it. Null resolves to the server level, which is the right answer for a
 * message from a channel we know nothing else about.
 */
export function getPlacement(host: string, channelId: string): ChannelPlacement | null {
  return placements[host]?.[channelId] ?? null;
}

/** What a scope is set to outright, ignoring anything it would inherit. */
export function getOwnLevel(
  host: string,
  scope: { kind: "server" } | { kind: "folder" | "channel"; id: string },
): NotificationLevel | null {
  const entry = prefs[host];
  if (!entry) return null;
  if (scope.kind === "server") return entry.server ?? null;
  const bag = scope.kind === "folder" ? entry.folders : entry.channels;
  return bag?.[scope.id] ?? null;
}
