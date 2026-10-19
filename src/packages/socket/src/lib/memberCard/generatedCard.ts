/**
 * The card somebody has before they make one: a style worked out from their name, the
 * way their owl is. Everybody's app draws the same one, and nothing is stored for it.
 */

import { randomCardStyle } from "@gryt/ui";

import { type CardProfile, cardProfileOf, type CardStyle } from "./cardStyle";

/** FNV-1a over the name, folded to 32 bits. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, and the same sequence for the same seed in every app. */
function sequence(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, CardStyle>();

/** The same style for the same name, however the name is cased or padded. */
export function generatedCardStyle(name: string): CardStyle {
  const key = name.trim().toLowerCase();
  let style = cache.get(key);
  if (!style) {
    style = randomCardStyle(sequence(hash(key)));
    cache.set(key, style);
  }
  return style;
}

type CardFields = { cardStyle?: unknown; bio?: unknown; pronouns?: unknown; statusLine?: unknown };

/** A member's card. With no style on the server they get the generated one; `{ plain: true }` is a choice and stays plain. */
export function cardProfileFor(member: CardFields, name: string | null | undefined): CardProfile {
  const profile = cardProfileOf(member);
  if ((member.cardStyle === null || member.cardStyle === undefined) && name) {
    return { ...profile, cardStyle: generatedCardStyle(name) };
  }
  return profile;
}
