/**
 * Your own card, kept locally so a server you join next gets it too, the way the
 * designed owl does. One card for every server, like the status line under your name.
 */

import { useSyncExternalStore } from "react";

import { type CardProfile, cardProfileOf, cardStyleForWire, DEFAULT_CARD_STYLE } from "./cardStyle";
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
