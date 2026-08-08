/**
 * A generated avatar for anyone who has not set one.
 *
 * Replaces the letter tile. A first initial is a poor identifier — half a member
 * list is an S — where a generated face is distinguishable at a glance and stays
 * the same every time you see that person.
 *
 * Rendered locally through @dicebear/core rather than api.dicebear.com. The seed
 * identifies a user, so calling the API would send that to a third party on
 * every render, and would leave any deployment without internet access showing
 * nothing. Same SVG, no network.
 *
 * Notionists is CC0, so nothing here has to be credited and nobody running their
 * own Gryt inherits an attribution obligation they did not choose.
 */

import { notionists } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";

/**
 * Backgrounds are not optional.
 *
 * Notionists renders transparent, which on a dark UI is a head floating in the
 * page. It also matters beyond looks: voice tiles are tinted from the avatar's
 * dominant colour, and a transparent image gives that nothing to sample.
 *
 * Picked wide rather than from the brand violets. The job here is telling six
 * people apart in a sidebar at 32px, and a column of tinted violets does not do
 * that. DiceBear chooses from this deterministically, so a given person always
 * gets the same one.
 */
const BACKGROUND_COLOURS = [
  "b6e3f4", // blue
  "c0aede", // violet
  "d1d4f9", // periwinkle
  "ffd5dc", // pink
  "ffdfbf", // peach
  "c5e8c8", // green
  "ffe9a8", // yellow
  "e0c3a0", // tan
];

const cache = new Map<string, string>();

/**
 * A data URI for `seed`'s avatar.
 *
 * Cached because these render in lists that re-render often, and generating the
 * same SVG per row per paint is wasteful. The seed is stable, so the result
 * never needs invalidating.
 */
export function generatedAvatarUrl(seed: string): string {
  const cached = cache.get(seed);
  if (cached) return cached;

  const svg = createAvatar(notionists, {
    seed,
    backgroundColor: BACKGROUND_COLOURS,
    // Notionists draws head-and-shoulders with room around it. Avatars here are
    // circular and small, so without this the face sits too far in to read.
    scale: 130,
    radius: 50,
  }).toString();

  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(seed, url);
  return url;
}

/**
 * What to show for a user: their own avatar if they have one, otherwise a
 * generated one.
 *
 * Takes the seed rather than deriving it, because callers know which identifier
 * they hold. Today that is the per-server user id — the only stable identifier
 * a client has for anyone but itself, since the member list deliberately does
 * not carry Gryt ids. That does mean the same person is drawn differently on
 * two servers, which matches how a real avatar already behaves: those are stored
 * per server too.
 */
export function resolveAvatarSrc(
  uploadedUrl: string | null | undefined,
  seed: string | null | undefined,
): string | undefined {
  if (uploadedUrl) return uploadedUrl;
  if (!seed) return undefined;
  return generatedAvatarUrl(seed);
}
