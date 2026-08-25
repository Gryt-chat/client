/**
 * Gryt's owls: the avatar anybody gets who has not uploaded a picture.
 *
 * Split out of `generatedAvatar.ts`, which is now the server-icon half plus a
 * re-export of this one. The two were only ever together because both draw an
 * SVG from a seed; they share no code, and DiceBear's Planets definition is a
 * JSON import that Node will not take without an attribute — which meant none
 * of this could be checked outside a browser.
 *
 * The generator itself lives in `@gryt/owl`. The mobile app runs the same file,
 * because two apps drawing one person as two different people is the failure
 * the package exists to prevent.
 */

import { avatarSeed, decodeWorn, owlAvatarColour, owlAvatarSvg, TILE_HUES, wornToOptions } from "@gryt/owl";

// Re-exported so the rest of the app keeps importing these from `@/common`. Two
// apps have to agree on the seed rule exactly, which is why it ships with the
// generator rather than being written out again on each side.
export { avatarSeed };
export { TILE_HUES };

const cache = new Map<string, string>();

/**
 * A data URI for `seed`'s owl.
 *
 * Cached because these render in lists that re-render often, and generating the
 * same SVG per row per paint is wasteful. The seed is stable, so the result
 * never needs invalidating.
 */
export function generatedAvatarUrl(seed: string): string {
  const cached = cache.get(seed);
  if (cached) return cached;

  const url = `data:image/svg+xml;utf8,${encodeURIComponent(owlAvatarSvg(seed))}`;
  cache.set(seed, url);
  return url;
}

/**
 * The colour `seed`'s owl is painted on, as `#rrggbb`.
 *
 * Voice tiles are tinted from the avatar's dominant colour, which the server
 * computes when someone uploads one. A generated avatar never goes near the
 * server, so without this the tile falls back to hashing the user id and lands
 * on a colour with no relationship to the avatar — a violet owl on a green
 * tile. This is the colour the generator actually used, rather than something
 * sampled back out of the SVG.
 *
 * It normalises through `avatarSeed` first. Callers pass a raw nickname, and
 * before the owls this took it as given: a tile for "Sivert" was tinted from a
 * seed the avatar renderer never saw, because the renderer lowercases and this
 * did not. The two agreed for anybody whose nickname was already lower case,
 * which is most people, which is why it went unnoticed.
 */
export function generatedAvatarColor(nickname: string, worn?: string | null): string | undefined {
  const seed = avatarSeed(nickname);
  if (!seed) return undefined;
  const look = decodeWorn(worn);
  return look ? owlAvatarColour(seed, wornToOptions(look)) : owlAvatarColour(seed);
}

/**
 * A data URI for `seed`'s owl wearing `look`.
 *
 * Keyed on both, because the same person has one owl per look and a cache keyed
 * on the seed alone would hand back whatever they were wearing first.
 */
function designedAvatarUrl(seed: string, worn: string): string | undefined {
  const key = `${seed}\u0000${worn}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const look = decodeWorn(worn);
  if (!look) return undefined;

  const url = `data:image/svg+xml;utf8,${encodeURIComponent(owlAvatarSvg(seed, wornToOptions(look)))}`;
  cache.set(key, url);
  return url;
}

/**
 * What to show for a user, in the order the three kinds of avatar outrank each
 * other: the owl they designed, then a picture they uploaded, then the owl
 * their name draws.
 *
 * A designed owl beats the upload rather than losing to it, and that is not the
 * obvious way round. Saving a design uploads a PNG as well — it is what a
 * client too old to know about `worn` shows, and it is where the server gets
 * the dominant colour a voice tile is tinted with — so the two are set
 * together, on purpose, and one of them has to win. The string wins because it
 * is the better copy: drawn at whatever size it is shown rather than at the
 * 256px it was rastered at, and it follows a palette change instead of freezing
 * the colours it was saved with.
 *
 * Which means going back to a photograph is not "upload a photograph". It is
 * that plus clearing the string, and profileSettings.tsx does both. If a
 * photograph ever appears not to take, this is the reason to look at first.
 *
 * An unreadable string falls through rather than failing — a look from a client
 * newer than this one should cost the look, not the avatar.
 */
export function resolveAvatarSrc(
  uploadedUrl: string | null | undefined,
  nickname: string | null | undefined,
  worn?: string | null,
): string | undefined {
  const seed = avatarSeed(nickname);
  if (seed && worn) {
    const designed = designedAvatarUrl(seed, worn);
    if (designed) return designed;
  }
  if (uploadedUrl) return uploadedUrl;
  if (!seed) return undefined;
  return generatedAvatarUrl(seed);
}

