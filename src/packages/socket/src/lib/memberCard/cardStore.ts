/**
 * Your own card, kept locally so a server you join next gets it too, the way the
 * designed owl does. One card for every server, like the status line under your name.
 */

import { useSyncExternalStore } from "react";

import { type CardProfile, cardProfileOf, type CardStyle, cardStyleForWire, DEFAULT_CARD_STYLE } from "./cardStyle";
import { generatedCardStyle } from "./generatedCard";

const KEY = "memberCard";
const listeners = new Set<() => void>();
let cached: CardProfile | null | undefined;

function read(): CardProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? cardProfileOf(JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function getStoredCard(): CardProfile | null {
  if (cached === undefined) cached = read();
  return cached;
}

export function setStoredCard(card: CardProfile): void {
  cached = card;
  try {
    localStorage.setItem(KEY, JSON.stringify(card));
  } catch {
    // Storage that will not write costs the next server the card, nothing else.
  }
  listeners.forEach((fn) => fn());
}

export function useStoredCard(): CardProfile | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getStoredCard,
  );
}

/** What `profile:update` carries for the card. Null clears a field; the plain card is sent as a choice, not as nothing. */
export function cardUpdatePayload(card: CardProfile) {
  return {
    cardStyle: cardStyleForWire(card.cardStyle) ?? { plain: true as const },
    bio: card.bio,
    pronouns: card.pronouns,
    statusLine: card.statusLine,
  };
}

/** Whether a server has anything on this card, so a join does not overwrite it. */
export function hasCardFields(member: { cardStyle?: unknown; bio?: unknown; pronouns?: unknown; statusLine?: unknown }): boolean {
  return Boolean(member.cardStyle || member.bio || member.pronouns || member.statusLine);
}

/** Whether a card is still the default one, with nothing written on it. */
export function isDefaultCard(card: CardProfile): boolean {
  return !card.bio && !card.pronouns && !card.statusLine && cardStyleForWire(card.cardStyle) === null;
}

export const EMPTY_CARD: CardProfile = { cardStyle: DEFAULT_CARD_STYLE, bio: null, pronouns: null, statusLine: null };

const RANDOMISED_KEY = "memberCardRandomised";

/**
 * The card to offer a server that has none for you. Somebody who never styled theirs gets
 * the one worked out from their name, once, so older apps and the phone show it too.
 */
export function cardToOffer(nickname: string | null | undefined): CardProfile | null {
  let card = getStoredCard();
  let done = false;
  try {
    done = localStorage.getItem(RANDOMISED_KEY) === "1";
  } catch {
    done = true;
  }
  if ((!card || cardStyleForWire(card.cardStyle) === null) && !done && nickname) {
    card = { ...(card ?? EMPTY_CARD), cardStyle: generatedCardStyle(nickname) };
    setStoredCard(card);
    try {
      localStorage.setItem(RANDOMISED_KEY, "1");
    } catch {
      // Without storage this runs again next launch and lands on the same style.
    }
  }
  return card && !isDefaultCard(card) ? card : null;
}

/* ── Cards used before, kept on this device like the owl's wardrobe ── */

const HISTORY_KEY = "memberCardHistory";
const HISTORY_MAX = 12;
const historyListeners = new Set<() => void>();
let history: CardStyle[] | undefined;

function readHistory(): CardStyle[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.map((r) => cardProfileOf({ cardStyle: r }).cardStyle).slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function writeHistory(next: CardStyle[]): void {
  history = next;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next.map((s) => cardStyleForWire(s))));
  } catch {
    // The list is a convenience; losing it costs nothing else.
  }
  historyListeners.forEach((fn) => fn());
}

const sameStyle = (a: CardStyle, b: CardStyle) => JSON.stringify(cardStyleForWire(a)) === JSON.stringify(cardStyleForWire(b));

/** Newest first, no repeats, and the plain card is not worth remembering. */
export function rememberCardStyle(style: CardStyle): void {
  if (cardStyleForWire(style) === null) return;
  const rest = (history ?? readHistory()).filter((s) => !sameStyle(s, style));
  writeHistory([style, ...rest].slice(0, HISTORY_MAX));
}

export function forgetCardStyle(style: CardStyle): void {
  writeHistory((history ?? readHistory()).filter((s) => !sameStyle(s, style)));
}

export function useCardHistory(): CardStyle[] {
  return useSyncExternalStore(
    (fn) => {
      historyListeners.add(fn);
      return () => historyListeners.delete(fn);
    },
    () => (history ??= readHistory()),
  );
}
