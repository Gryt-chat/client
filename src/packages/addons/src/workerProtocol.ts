/**
 * What a plugin and the app say to each other. A plugin runs in a worker, so this
 * is its whole reach. Free of every other module: both sides import it (GRYT-930).
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
   * Wind up. The worker gets a moment to run its cleanup handlers and is then
   * terminated whether or not it did.
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
 * How long a plugin gets to finish its cleanup after being told to stop. One that
 * ignores it is terminated anyway, which is the point of doing it from outside.
 */
export const STOP_GRACE_MS = 150;

/**
 * What each call costs, and the list of calls there are. Here because the check
 * that reads it imports this file, and this file imports nothing (GRYT-930).
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
 * Whether a plugin may make this call. The manifest's list and the grant both
 * have to say yes. A method nobody serves is refused rather than allowed.
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
 * A panel, as a plugin describes it and the app draws it. A title and rows of
 * text — the app never receives anything it would execute or insert (GRYT-951).
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
 * Caps, in the same spirit as the messaging ones: about what fits in a 240px rail
 * rather than about memory. More is truncated rather than refused.
 */
export const MAX_PANEL_TITLE = 48;
export const MAX_PANEL_ROWS = 20;
export const MAX_PANEL_LABEL = 48;
export const MAX_PANEL_VALUE = 64;

/*
 * Control characters, including the bidirectional overrides. A right-to-left
 * override reorders everything drawn after it, so a row renders as another.
 */

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(CONTROL, "").trim();
  return clean ? clean.slice(0, max) : null;
}

/**
 * Read what a plugin sent, or say why it is not a panel. Everything here arrived
 * from a plugin, and a plugin's data usually came from somebody else's client.
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
