/**
 * Your own card, kept locally so a server you join next gets it too, the way the
 * designed owl does. One card for every server, like the status line under your name.
 */

import { randomCardStyle } from "@gryt/ui";
import { useSyncExternalStore } from "react";

import { type CardProfile, cardProfileOf, cardStyleForWire, DEFAULT_CARD_STYLE } from "./cardStyle";

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

/** What `profile:update` carries for the card. Null clears a field. */
export function cardUpdatePayload(card: CardProfile) {
  return {
    cardStyle: cardStyleForWire(card.cardStyle),
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
 * The card to offer a server that has none for you. Somebody still on the plain default
 * card gets a random style once, kept like any card they made, so every server shows it.
 */
export function cardToOffer(): CardProfile | null {
  let card = getStoredCard();
  let done = false;
  try {
    done = localStorage.getItem(RANDOMISED_KEY) === "1";
  } catch {
    done = true;
  }
  if ((!card || isDefaultCard(card)) && !done) {
    card = { ...(card ?? EMPTY_CARD), cardStyle: randomCardStyle() };
    setStoredCard(card);
    try {
      localStorage.setItem(RANDOMISED_KEY, "1");
    } catch {
      // Without storage this could randomise again next launch; the stored card above wins then.
    }
  }
  return card && !isDefaultCard(card) ? card : null;
}
