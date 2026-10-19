import { massMentionHits } from "../../../lib/mentionTokens.ts";

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
  /** What the server says this channel is heard at until this person decides. */
  defaultLevel?: NotificationLevel | null;
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

/** What a channel comes out as when this person has not set it: its folder or
    the server, quietened by the default the server carries for it. */
export function resolveInheritedLevel(
  prefs: NotificationPrefs,
  host: string,
  placement: ChannelPlacement | null,
): NotificationLevel {
  const scope = prefs[host];
  let inherited: NotificationLevel = scope?.server ?? "all";
  const parent = placement?.parentItemId;
  const folder = parent ? scope?.folders?.[parent] : undefined;
  if (folder) inherited = folder;

  /* The channel's default only quietens: a server muted on purpose stays muted,
     and a feed nobody asked to hear stays quiet under "everything". */
  const preset = placement?.defaultLevel;
  return preset ? quieterOf(inherited, preset) : inherited;
}

/** What this channel is set to: this person's own answer for it, else the inherited one. */
export function resolveLevel(
  prefs: NotificationPrefs,
  host: string,
  placement: ChannelPlacement | null,
): NotificationLevel {
  const own = placement ? prefs[host]?.channels?.[placement.channelId] : undefined;
  return own ?? resolveInheritedLevel(prefs, host, placement);
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

/** Take the channel-to-folder map and each channel's default out of a fresh `server:details`. */
export function rememberPlacements(
  host: string,
  items: { kind?: string; channelId?: string | null; parentItemId?: string | null }[],
  channels: { id: string; defaultNotificationLevel?: NotificationLevel | null }[] = [],
) {
  const byChannel: Record<string, ChannelPlacement> = {};
  for (const item of items) {
    if (item.kind !== "channel" || !item.channelId) continue;
    byChannel[item.channelId] = {
      channelId: item.channelId,
      parentItemId: item.parentItemId ?? null,
    };
  }
  /* A channel off the sidebar still gets a placement, so its default is not
     lost with its folder. An older server sends no level, which reads as none. */
  for (const channel of channels) {
    const level = isLevel(channel.defaultNotificationLevel) ? channel.defaultNotificationLevel : null;
    const known = byChannel[channel.id] ?? { channelId: channel.id, parentItemId: null };
    byChannel[channel.id] = { ...known, defaultLevel: level };
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

// ── Whether a message makes a noise ─────────────────────────────────────────
//
// One answer for the server on screen and for the ones in the background. The
// two handlers used to decide on their own, and disagreed about focus.

/** What the deciding function needs to know beyond the message itself. */
export interface MessageNotificationContext {
  /** This member's own server user id here, so their echo is never announced. */
  myId?: string | null;
  /** Whether this server is the one on screen. */
  viewingThisServer: boolean;
  /** Whether the app window has focus, which is `document.hasFocus()` in a browser. */
  windowFocused: boolean;
  /** Whether the message names this member, as `mentionsMember` answers it. */
  mentionsMe?: boolean;
}

/** The parts of a `chat:new` payload the decision reads. */
export interface NotifiableMessage {
  conversation_id?: string | null;
  thread_id?: string | null;
  sender_server_id?: string | null;
}

/** The server's own notices and webhook posts never record a mention, so they
    cannot name anybody here either. The same two strings as chatViewHelpers.ts. */
function isPersonSender(sender: string | null | undefined): boolean {
  return !!sender && sender !== "system" && !sender.startsWith("webhook:");
}

/**
 * Whether a message names this member, by the rule the server pings on: `@nickname`
 * on its own, case-insensitive, or the `(mention:id)` link the composer writes.
 */
export function mentionsMember(
  msg: { text?: string | null; sender_server_id?: string | null },
  me: {
    serverUserId?: string | null;
    nickname?: string | null;
    roleIds?: readonly string[];
    suppressEveryone?: boolean;
  },
): boolean {
  const text = msg.text;
  if (!text || !text.includes("@") || !isPersonSender(msg.sender_server_id)) return false;
  if (me.serverUserId && text.includes(`(mention:${me.serverUserId})`)) return true;
  if (massMentionHits(text, me)) return true;

  const nickname = me.nickname?.trim().toLowerCase();
  if (!nickname) return false;
  const lower = text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(`@${nickname}`, from);
    if (at === -1) return false;
    // A word character either side means an email address, or a longer name.
    const before = at > 0 ? lower[at - 1] : "";
    const after = lower[at + 1 + nickname.length] ?? "";
    if (!/\w/.test(before) && !/\w/.test(after)) return true;
    from = at + 1;
  }
}

/**
 * Whether a message just arrived should badge, sound and notify. Marking it unread
 * is a separate question the handlers answer before asking this one.
 */
export function shouldNotifyForMessage(
  host: string,
  msg: NotifiableMessage,
  ctx: MessageNotificationContext,
): boolean {
  if (ctx.myId && msg.sender_server_id === ctx.myId) return false;
  // On screen in a focused window: the message is in view or one click away.
  if (ctx.viewingThisServer && ctx.windowFocused) return false;

  const placement = msg.conversation_id ? getPlacement(host, msg.conversation_id) : null;
  const level = resolveAnnounceLevel(host, placement);
  // Being named is being named, in a thread as much as in the channel.
  if (ctx.mentionsMe) return shouldAnnounceMention(level);
  // A plain thread reply is news about the thread, and the thread tracker holds it.
  if (msg.thread_id) return false;
  return shouldAnnounceMessage(level);
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

// ── Whether a channel shows anything ────────────────────────────────────────
//
// "Nothing" means silent everywhere, not just unannounced: no badge, no bold,
// no count. Read markers still move underneath; only what is drawn goes quiet.

/** Whether this conversation is muted: level "Nothing", set on it or inherited.
    Not the global ceiling, which quietens everything for a different reason. */
export function isChannelMuted(host: string, channelId: string): boolean {
  return resolveLevel(stored.servers, host, getPlacement(host, channelId)) === "none";
}

/** `counts`, with a muted conversation's entry left out. The map is returned
    unchanged when nothing needed removing. */
export function visibleCounts(
  host: string,
  counts: Map<string, number>,
): Map<string, number> {
  let out = counts;
  for (const id of counts.keys()) {
    if (!isChannelMuted(host, id)) continue;
    if (out === counts) out = new Map(counts);
    out.delete(id);
  }
  return out;
}

// ── Hiding muted channels ───────────────────────────────────────────────────
//
// Per server and per device, like a collapsed folder. Kept beside the levels it
// reads, and announced through the same listeners so both menus stay in step.

const HIDE_MUTED_PREFIX = "gryt_sidebar_hide_muted:";
const hideMuted = new Map<string, boolean>();

/** Whether this server's sidebar leaves muted channels out. Off until chosen. */
export function getHideMuted(host: string): boolean {
  const known = hideMuted.get(host);
  if (known !== undefined) return known;
  let on = false;
  try {
    on = localStorage.getItem(HIDE_MUTED_PREFIX + host) === "1";
  } catch {
    // Unreadable is off, which shows every channel.
  }
  hideMuted.set(host, on);
  return on;
}

export function setHideMuted(host: string, on: boolean) {
  if (getHideMuted(host) === on) return;
  hideMuted.set(host, on);
  try {
    if (on) localStorage.setItem(HIDE_MUTED_PREFIX + host, "1");
    else localStorage.removeItem(HIDE_MUTED_PREFIX + host);
  } catch {
    // Holds for this session; next launch shows everything again.
  }
  emit();
}

// ── Suppressing @everyone and @here ─────────────────────────────────────────
//
// Per server and per device, like hiding muted channels. Role mentions and
// being named still come through.

const SUPPRESS_EVERYONE_PREFIX = "gryt_suppress_everyone:";
const suppressEveryone = new Map<string, boolean>();

export function getSuppressEveryone(host: string): boolean {
  const known = suppressEveryone.get(host);
  if (known !== undefined) return known;
  let on = false;
  try {
    on = localStorage.getItem(SUPPRESS_EVERYONE_PREFIX + host) === "1";
  } catch {
    // Unreadable is off, which lets @everyone through.
  }
  suppressEveryone.set(host, on);
  return on;
}

export function setSuppressEveryone(host: string, on: boolean) {
  if (getSuppressEveryone(host) === on) return;
  suppressEveryone.set(host, on);
  try {
    if (on) localStorage.setItem(SUPPRESS_EVERYONE_PREFIX + host, "1");
    else localStorage.removeItem(SUPPRESS_EVERYONE_PREFIX + host);
  } catch {
    // Holds for this session.
  }
  emit();
}

/** One sidebar row, as much of it as the rule reads. */
export interface SidebarRowRef {
  id: string;
  kind?: string;
  channelId?: string | null;
  parentItemId?: string | null;
}

/** What the sidebar leaves out, and how many channels that is. */
export interface HiddenMutedRows {
  /** Item ids: the channels, and any folder left with none of its own. */
  rows: Set<string>;
  channels: number;
}

/**
 * Which rows go while muted channels are hidden. Muted is "nothing" and only that;
 * `keep` holds channel ids drawn regardless, like the one open or one naming you.
 */
export function hiddenMutedRows(
  prefs: NotificationPrefs,
  host: string,
  items: SidebarRowRef[],
  channels: { id: string; defaultNotificationLevel?: NotificationLevel | null }[],
  keep: ReadonlySet<string>,
): HiddenMutedRows {
  const folders = new Set(items.filter((i) => i.kind === "folder").map((i) => i.id));
  const defaults = new Map(channels.map((c) => [c.id, c.defaultNotificationLevel ?? null]));
  const rows = new Set<string>();
  const shownIn = new Map<string, number>();
  const hiddenIn = new Map<string, number>();
  let count = 0;

  for (const item of items) {
    if (item.kind !== "channel") continue;
    const channelId = item.channelId ?? item.id;
    // A parent that is not a real folder is the top level, as the sidebar draws it.
    const parent = item.parentItemId && folders.has(item.parentItemId) ? item.parentItemId : null;
    const preset = defaults.get(channelId);
    const level = resolveLevel(prefs, host, {
      channelId,
      parentItemId: parent,
      defaultLevel: isLevel(preset) ? preset : null,
    });
    const hide = level === "none" && !keep.has(channelId);
    if (hide) {
      rows.add(item.id);
      count += 1;
    }
    if (parent) {
      const bag = hide ? hiddenIn : shownIn;
      bag.set(parent, (bag.get(parent) ?? 0) + 1);
    }
  }

  // Only a folder that had channels and lost them all. An empty one is not muted.
  for (const folder of hiddenIn.keys()) {
    if (!shownIn.has(folder)) rows.add(folder);
  }
  return { rows, channels: count };
}
