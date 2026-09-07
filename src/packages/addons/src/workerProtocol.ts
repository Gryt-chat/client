/**
 * What a plugin and the app say to each other (GRYT-930).
 *
 * A plugin runs in a worker now, so this is the whole of its reach. Everything
 * it can do is a message the host either serves or refuses, and there is no
 * second door — no `window`, no DOM, no `localStorage`, no module the app has
 * already imported, and no identity keypair.
 *
 * That is the difference between this and what came before. `capabilities.ts`
 * used to open by saying, at length, that a granted capability was a claim
 * rather than a boundary, because a plugin that did not want to ask simply did
 * not call `window.gryt`. There is nothing else to call now.
 *
 * Kept free of every other module on purpose: both sides import it, and one of
 * those sides is a worker that must not pull the app in behind it.
 */

/** Host → worker. */
export type HostMessage =
  /** Start: import this plugin's entry point. */
  | { kind: "load"; addonId: string; url: string; theme: ThemeInfo; version: string }
  /** The answer to one `call`. */
  | { kind: "result"; id: number; ok: true; value: unknown }
  | { kind: "result"; id: number; ok: false; error: string }
  /** Something happened. Pushed rather than polled. */
  | { kind: "event"; event: string; payload: unknown }
  /**
   * Wind up. The worker is given a moment to run its cleanup handlers and is
   * then terminated whether or not it did — a plugin cannot refuse to stop by
   * never finishing.
   */
  | { kind: "stop" };

/** Worker → host. */
export type WorkerMessage =
  /** The plugin wants something. Every capability check happens on the answer. */
  | { kind: "call"; id: number; method: string; args: unknown[] }
  /** The plugin's own logging, so it reaches the console with its id on it. */
  | { kind: "log"; level: "info" | "warn" | "error"; message: string }
  /** Import finished, or did not. */
  | { kind: "ready" }
  | { kind: "failed"; error: string };

export interface ThemeInfo {
  appearance: "light" | "dark";
  accentColor: string;
}

/**
 * How long a plugin gets to finish its cleanup after being told to stop.
 *
 * Long enough for a handler that clears a timer and sends a last message,
 * short enough that turning an addon off never feels like it hung. A plugin
 * that ignores it is terminated anyway, which is the point of doing this from
 * outside rather than asking nicely.
 */
export const STOP_GRACE_MS = 150;

/**
 * What each call costs, and the list of calls there are (GRYT-930).
 *
 * Here rather than beside the code that serves them, because the check that
 * reads it has to be able to import this file — and this file imports nothing,
 * which is the property that makes the worker worth having.
 *
 * Capabilities are plain strings here for the same reason. The typed union
 * lives in `capabilities.ts`; a wire protocol that reached for it would stop
 * being a leaf to gain a type it does not need.
 */
export const METHOD_CAPABILITY: Record<string, string> = {
  setActivity: "status",
  "messaging.send": "messaging",
  "messaging.subscribe": "messaging",
  "messaging.servers": "messaging",
};

export type CallVerdict =
  | { allowed: true }
  /** `needs: null` means the method does not exist, not that it was denied. */
  | { allowed: false; needs: string | null };

/**
 * Whether a plugin may make this call.
 *
 * Pure, and both lists are passed in: what the manifest declared and what
 * somebody granted. Both have to say yes. An addon that drops a capability in
 * an update while keeping the agreement made when it had one is the case the
 * first list is for.
 *
 * A method nobody serves is refused rather than allowed. The worker is the only
 * caller, so an unknown method is a typo on the other side of the port, and
 * refusing turns it into an error instead of a promise that never settles.
 */
export function mayCall(
  declared: readonly string[],
  granted: readonly string[],
  method: string,
): CallVerdict {
  const needs = Object.prototype.hasOwnProperty.call(METHOD_CAPABILITY, method)
    ? METHOD_CAPABILITY[method]
    : undefined;
  if (!needs) return { allowed: false, needs: null };
  if (!declared.includes(needs) || !granted.includes(needs)) {
    return { allowed: false, needs };
  }
  return { allowed: true };
}
