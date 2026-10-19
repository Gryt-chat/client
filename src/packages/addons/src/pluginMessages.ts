/**
 * Routing a plugin's messages to the right plugin. Nothing but this keeps one of
 * two installed plugins from hearing the other's, so it imports nothing (GRYT-939).
 */

/** What a plugin's other half sent, from a server this person is on. */
export interface PluginMessage {
  /** Which server. A plugin runs once and this person may be on several. */
  host: string;
  topic: string;
  /**
   * Whatever the server plugin sent. **Written by whoever runs that server.** The
   * transport caps its size and its shape and nothing else.
   */
  data: unknown;
}

export type PluginMessageHandler = (message: PluginMessage) => void;

/*
 * The listener map is keyed on `addonId` and the topic with a newline between, so
 * a topic allowed to contain one would let a plugin register under another's key.
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
 * A copy per handler, `data` included, so two handlers on one topic see the same
 * message. `structuredClone` throwing means a hand-built message; send the original.
 */
function copyFor(message: PluginMessage): PluginMessage {
  try {
    return structuredClone(message);
  } catch {
    return { ...message };
  }
}

const listeners = new Map<string, Set<PluginMessageHandler>>();

/** A plugin a server is running, as it describes itself. */
export interface AnnouncedPlugin {
  id: string;
  name: string;
  author?: string;
  description?: string;
  /** Where to read about it. The server has already checked it is http(s). */
  homepage?: string;
  /**
   * What it may do, in the server's own vocabulary — `messages:read`, `moderation`.
   * Here because it is the half a person can act on (GRYT-941).
   */
  capabilities: string[];
}

/*
 * No version, and that is the server's decision. A version number is which known
 * problem applies, so it narrows an attack rather than describing the plugin.
 */

/**
 * Which plugins each server says it runs. Every plugin, not a chosen few: a server
 * names all of them or it is running an old build (GRYT-939, GRYT-941).
 */
const announcedByHost = new Map<string, AnnouncedPlugin[]>();

/** Replaces the list for one host, as `server:details` arrives. */
export function setAnnouncedPlugins(
  host: string,
  plugins: readonly AnnouncedPlugin[],
): void {
  announcedByHost.set(
    host,
    plugins.map((p) => ({
      id: p.id,
      name: p.name,
      author: p.author,
      description: p.description,
      homepage: p.homepage,
      /* Copied rather than referenced. What a plugin may do is the half a person
         decides on, and a list anything downstream can edit is not one. */
      capabilities: [...(p.capabilities ?? [])],
    })),
  );
}

/** Forget a server that is gone, so a plugin does not keep sending into it. */
export function forgetAnnouncedPlugins(host: string): void {
  announcedByHost.delete(host);
}

/**
 * The servers running the other half of this plugin, so it can stop polling and say
 * why nothing is happening. Hosts and nothing else — no version, on purpose.
 */
export function serversRunning(addonId: string): string[] {
  const out: string[] = [];
  for (const [host, plugins] of announcedByHost) {
    if (plugins.some((p) => p.id === addonId)) out.push(host);
  }
  return out.sort();
}

/**
 * Everything one server is running, for showing somebody what is between them and
 * the people they talk to. Empty from a server too old to say (GRYT-941).
 */
export function pluginsOn(host: string): AnnouncedPlugin[] {
  return (announcedByHost.get(host) ?? []).map((p) => ({
    ...p,
    capabilities: [...p.capabilities],
  }));
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
 * One message in from a server. A throwing handler is caught so one plugin's
 * mistake does not stop the next. The capability is not re-checked on delivery.
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
 * Forget what an addon was listening for. Without it a disabled plugin keeps
 * receiving, and a reloaded one has two generations of handlers running.
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
