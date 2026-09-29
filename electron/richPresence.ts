/**
 * What games say over the Rich Presence socket, turned into the card the server
 * takes. Drops repeats and slows the rest down before anything leaves the machine.
 */

import type { ActivityEvent } from "./discordIpc";

export type CardType = "playing" | "listening" | "watching" | "competing";

/** The server's shape (`richActivity`). It checks everything again; this keeps the upload small. */
export interface RichCard {
  type: CardType;
  name: string;
  details?: string;
  state?: string;
  startedAt?: number;
  party?: { size: number; max?: number };
  buttons?: { label: string; url: string }[];
}

/** What a card is called when the game isn't in `games.json` and didn't say. */
export const UNKNOWN_GAME = "A game";

/** Games send every few seconds. Discord itself takes five in twenty. */
export const MIN_INTERVAL_MS = 15_000;

const TYPES: Record<number, CardType> = { 0: "playing", 2: "listening", 3: "watching", 5: "competing" };

function line(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Discord's own libraries send seconds, and some games milliseconds. */
function toMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value < 1e12 ? Math.floor(value * 1000) : Math.floor(value);
}

export function cardFromActivity(activity: Record<string, unknown>, name: string): RichCard {
  const card: RichCard = { type: TYPES[activity.type as number] ?? "playing", name: name.slice(0, 64) };
  const details = line(activity.details, 128);
  if (details) card.details = details;
  const state = line(activity.state, 128);
  if (state) card.state = state;
  const startedAt = toMs(record(activity.timestamps)?.start);
  if (startedAt) card.startedAt = startedAt;
  const size = record(activity.party)?.size;
  if (Array.isArray(size) && typeof size[0] === "number") {
    card.party = typeof size[1] === "number" ? { size: size[0], max: size[1] } : { size: size[0] };
  }
  if (Array.isArray(activity.buttons)) {
    const buttons = activity.buttons
      .map((b) => record(b))
      .filter((b): b is Record<string, unknown> => !!b && typeof b.label === "string" && typeof b.url === "string")
      .slice(0, 2)
      .map((b) => ({ label: (b.label as string).slice(0, 32), url: (b.url as string).slice(0, 512) }));
    if (buttons.length) card.buttons = buttons;
  }
  return card;
}

export interface SeenApp {
  id: string;
  /** Null for a game that isn't in the list and didn't give a name. */
  name: string | null;
}

export interface PresenceBoardOptions {
  /** Only when the card others should see changes. Null clears it. */
  onChange: (card: RichCard | null) => void;
  nameForApp: (appId: string) => string | null;
  minIntervalMs?: number;
  now?: () => number;
}

export interface PresenceBoard {
  update(event: ActivityEvent): void;
  setHidden(appIds: readonly string[]): void;
  /** Every app that has connected since start, for the list somebody hides apps from. */
  seen(): SeenApp[];
  current(): RichCard | null;
  /** Everything gone at once, when the socket is let go. */
  reset(): void;
  stop(): void;
}

export function createPresenceBoard(options: PresenceBoardOptions): PresenceBoard {
  const minInterval = options.minIntervalMs ?? MIN_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const live = new Map<number, { appId: string; card: RichCard; at: number }>();
  const seenApps = new Map<string, string | null>();
  let hidden = new Set<string>();
  let sent: RichCard | null = null;
  let sentAt = -Infinity;
  let timer: NodeJS.Timeout | null = null;

  /** The newest card from an app that isn't hidden. Two games at once is rare, and the newer one is what's on screen. */
  const pick = (): RichCard | null => {
    let best: { card: RichCard; at: number } | null = null;
    for (const entry of live.values()) {
      if (hidden.has(entry.appId)) continue;
      if (!best || entry.at >= best.at) best = entry;
    }
    return best?.card ?? null;
  };

  const same = (a: RichCard | null, b: RichCard | null) => JSON.stringify(a) === JSON.stringify(b);

  const flush = () => {
    timer = null;
    const next = pick();
    if (same(next, sent)) return;
    sent = next;
    sentAt = now();
    options.onChange(next);
  };

  const schedule = () => {
    const next = pick();
    if (same(next, sent)) {
      if (timer) clearTimeout(timer);
      timer = null;
      return;
    }
    // A clear goes at once: a game that closed shouldn't sit on somebody's card.
    if (next === null || now() - sentAt >= minInterval) {
      if (timer) clearTimeout(timer);
      flush();
      return;
    }
    if (!timer) {
      timer = setTimeout(flush, Math.max(0, sentAt + minInterval - now()));
      timer.unref?.();
    }
  };

  return {
    update(event) {
      if (event.activity === null) {
        live.delete(event.connection);
      } else {
        const listed = options.nameForApp(event.clientId);
        const given = line(event.activity.name, 64);
        seenApps.set(event.clientId, listed ?? given ?? null);
        const card = cardFromActivity(event.activity, listed ?? given ?? UNKNOWN_GAME);
        const previous = live.get(event.connection);
        // A repeat keeps its place, so a game resending the same card doesn't jump ahead of the other.
        const at = previous && same(previous.card, card) ? previous.at : now();
        live.set(event.connection, { appId: event.clientId, card, at });
      }
      schedule();
    },
    setHidden(appIds) {
      hidden = new Set(appIds);
      schedule();
    },
    seen: () => [...seenApps].map(([id, name]) => ({ id, name })),
    current: () => sent,
    reset() {
      live.clear();
      schedule();
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
