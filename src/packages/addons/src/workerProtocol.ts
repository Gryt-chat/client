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
  "ui.panel": "display",
  "ui.clear": "display",
  "processes.running": "processes",
  "processes.subscribe": "processes",
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

/* ── What a plugin may draw ──────────────────────────────────────────── */

/**
 * A panel, as a plugin describes it and the app draws it (GRYT-951).
 *
 * The plugin sends this shape and nothing else. No markup, no HTML, no colours,
 * no node it hands over — a title and rows of text that Gryt renders with its
 * own components.
 *
 * That is the whole design. A plugin runs in a worker with no DOM, which is
 * what GRYT-930 bought and is worth keeping, so the alternative — an iframe, or
 * a node passed across — would give back most of what isolation took away. This
 * one cannot: the app never receives anything it would execute or insert, only
 * strings it puts in a `<div>`.
 */
export interface PluginPanel {
  title: string;
  rows: PluginPanelRow[];
}

export interface PluginPanelRow {
  /** Left column. A name, usually. */
  label: string;
  /** Right column. Optional, so a row can be one line of text. */
  value?: string;
}

/**
 * Caps, in the same spirit as the messaging ones.
 *
 * A panel is drawn in a 240px rail beside the member list, so these are about
 * what fits and stays readable rather than about memory. A plugin that sends
 * more is truncated rather than refused: half a roster is more useful than an
 * error, and a plugin whose list grew past twenty is not misbehaving.
 */
export const MAX_PANEL_TITLE = 48;
export const MAX_PANEL_ROWS = 20;
export const MAX_PANEL_LABEL = 48;
export const MAX_PANEL_VALUE = 64;

/*
 * Control characters, including the bidirectional overrides.
 *
 * A right-to-left override in a label reorders everything drawn after it, which
 * is how a row saying one thing renders as another — the trick that has been
 * used on filenames for twenty years. Stripped rather than refused, because the
 * plugin that sends one is usually passing through somebody's nickname.
 *
 * The rule this disables exists to catch a control character somebody typed by
 * accident. Here they are the subject: this is the only thing standing between
 * a plugin's string and a member list, and matching them is the whole job.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(CONTROL, "").trim();
  return clean ? clean.slice(0, max) : null;
}

/**
 * Read what a plugin sent, or say why it is not a panel.
 *
 * Pure and in this file for the reason the rest of it is: the check script that
 * asserts a plugin cannot smuggle markup through here has to import it, and a
 * `.mjs` cannot import a module that pulls in the app.
 *
 * Everything here arrived from a plugin, and a plugin's own data usually came
 * from somebody else's client before that — the presence example builds its
 * rows out of nicknames other people chose. So this is the boundary, and it is
 * strict about types and forgiving about size.
 */
export function readPanel(value: unknown): { ok: true; panel: PluginPanel } | { ok: false; reason: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "a panel is an object with a title and rows" };
  }

  const source = value as Record<string, unknown>;

  const title = readText(source.title, MAX_PANEL_TITLE);
  if (!title) return { ok: false, reason: "title has to be a non-empty string" };

  if (!Array.isArray(source.rows)) return { ok: false, reason: "rows has to be an array" };

  const rows: PluginPanelRow[] = [];
  for (const entry of source.rows.slice(0, MAX_PANEL_ROWS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;

    const label = readText(row.label, MAX_PANEL_LABEL);
    if (!label) continue;

    const text = readText(row.value, MAX_PANEL_VALUE);
    rows.push(text ? { label, value: text } : { label });
  }

  return { ok: true, panel: { title, rows } };
}
