/**
 * Routing a plugin's messages to the right plugin (GRYT-939).
 *
 * Two plugins can be installed at once, both listening, and neither can see the
 * other's manifest. Nothing but this keeps one from hearing the other's
 * messages, so it is its own module with nothing imported into it — the
 * capability gate lives in `pluginApi.ts`, and this is only the routing.
 *
 * Deliberately free of every other module here, so it can be driven by a check
 * script without a browser, a socket or a stubbed store.
 */

/** What a plugin's other half sent, from a server this person is on. */
export interface PluginMessage {
  /** Which server. A plugin runs once and this person may be on several. */
  host: string;
  topic: string;
  /**
   * Whatever the server plugin sent. **Written by whoever runs that server.**
   * The transport caps its size and its shape and nothing else; a plugin
   * rendering this is rendering somebody else's bytes.
   */
  data: unknown;
}

export type PluginMessageHandler = (message: PluginMessage) => void;

/*
 * The same shape the server accepts, checked here as well.
 *
 * Two reasons rather than one. A plugin author sending on a topic the server
 * will refuse gets told at the call instead of watching messages disappear into
 * a socket. And the listener map is keyed on `addonId\ntopic`, so a topic
 * allowed to contain a newline would let one plugin register under another's
 * key — which is the sort of thing that only ever happens on purpose.
 */
const TOPIC = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;

export function requireTopic(addonId: string, topic: unknown): string {
  if (typeof topic !== "string" || !TOPIC.test(topic)) {
    throw new Error(
      `[gryt] "${addonId}" used an invalid topic. A topic is up to 64 letters, ` +
        `digits, dot, dash, colon or underscore, starting with a letter or digit.`,
    );
  }
  return topic;
}

/**
 * A copy per handler, `data` included.
 *
 * Tidiness rather than safety — plugins share a page and can reach each other
 * whatever this does, which `capabilities.ts` says at length. What it buys is
 * that two handlers on the same topic see the same message, instead of the
 * second seeing whatever the first left behind. A shallow spread would protect
 * the envelope and share `data`, which is the half plugins actually touch.
 *
 * `structuredClone` can throw on something unclonable. Nothing arriving from a
 * socket is, so that path means the caller built the message by hand — and
 * delivering the original beats dropping it.
 */
function copyFor(message: PluginMessage): PluginMessage {
  try {
    return structuredClone(message);
  } catch {
    return { ...message };
  }
}

const listeners = new Map<string, Set<PluginMessageHandler>>();

/**
 * Which plugins each server says it runs (GRYT-939).
 *
 * Only the ones whose manifest asked to be visible, so this is empty for almost
 * every server and short for the rest. Kept per host because a person is on
 * several and the answer differs per server, which is the whole question a
 * plugin is asking.
 */
const announcedByHost = new Map<string, { id: string; version: string }[]>();

/** Replaces the list for one host, as `server:details` arrives. */
export function setAnnouncedPlugins(
  host: string,
  plugins: readonly { id: string; version: string }[],
): void {
  announcedByHost.set(host, plugins.map((p) => ({ id: p.id, version: p.version })));
}

/** Forget a server that is gone, so a plugin does not keep sending into it. */
export function forgetAnnouncedPlugins(host: string): void {
  announcedByHost.delete(host);
}

/**
 * The servers running the other half of this plugin, and which version.
 *
 * A plugin asks this to decide whether to say anything at all. Sending anyway
 * is harmless — the server drops it — but a plugin that knows can stop polling,
 * stop drawing an empty panel, and tell somebody why nothing is happening.
 */
export function serversRunning(addonId: string): { host: string; version: string }[] {
  const out: { host: string; version: string }[] = [];
  for (const [host, plugins] of announcedByHost) {
    const match = plugins.find((p) => p.id === addonId);
    if (match) out.push({ host, version: match.version });
  }
  return out.sort((a, b) => a.host.localeCompare(b.host));
}

/** For a check script, which must not inherit a previous case's servers. */
export function resetAnnouncedPlugins(): void {
  announcedByHost.clear();
}

const key = (addonId: string, topic: string) => `${addonId}\n${topic}`;

/** Returns a function that stops listening. */
export function subscribe(
  addonId: string,
  topic: string,
  handler: PluginMessageHandler,
): () => void {
  const k = key(addonId, requireTopic(addonId, topic));
  const set = listeners.get(k) ?? new Set<PluginMessageHandler>();
  set.add(handler);
  listeners.set(k, set);
  return () => {
    set.delete(handler);
    if (set.size === 0) listeners.delete(k);
  };
}

/**
 * One message in from a server.
 *
 * A handler that throws is caught and logged rather than left to take the
 * socket dispatch with it — one plugin's mistake must not stop the next
 * plugin's message, or the app's own handling of whatever came after.
 *
 * The capability is not re-checked here. A plugin forbidden since it subscribed
 * keeps hearing until its listeners are dropped, which is what
 * `dropListeners` is for — re-checking on delivery would put a lookup on every
 * message to close a window measured in the time it takes to click a switch.
 */
export function deliverPluginMessage(addonId: string, message: PluginMessage): void {
  const handlers = listeners.get(key(addonId, message.topic));
  if (!handlers) return;

  for (const handler of [...handlers]) {
    try {
      handler(copyFor(message));
    } catch (err) {
      console.error(`[PluginAPI] "${addonId}" threw handling ${message.topic}:`, err);
    }
  }
}

/**
 * Forget what an addon was listening for.
 *
 * Called when an addon is turned off or removed. Without it a disabled plugin
 * keeps receiving, and one reloaded from a changed file would have two
 * generations of handlers running at once.
 */
export function dropListeners(addonId: string): void {
  const prefix = `${addonId}\n`;
  for (const k of [...listeners.keys()]) {
    if (k.startsWith(prefix)) listeners.delete(k);
  }
}

/** For a check script, which must not inherit a previous case's listeners. */
export function resetPluginMessageListeners(): void {
  listeners.clear();
}
