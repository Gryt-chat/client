/**
 * Gryt's owls: the avatar anybody gets who has not uploaded a picture. The
 * generator lives in `@gryt/owl`, which the mobile app runs too.
 */

import { avatarSeed, decodeWorn, owlAvatarColour, owlAvatarSvg, TILE_HUES, wornToOptions } from "@gryt/owl";

// Re-exported so the rest of the app keeps importing these from `@/common`. Two
// apps have to agree on the seed rule, so it ships with the generator.
export { avatarSeed };
export { TILE_HUES };

const cache = new Map<string, string>();

/**
 * A data URI for `seed`'s owl. Cached because these render in lists that repaint
 * often; the seed is stable, so the result never needs invalidating.
 */
export function generatedAvatarUrl(seed: string): string {
  const cached = cache.get(seed);
  if (cached) return cached;

  const url = `data:image/svg+xml;utf8,${encodeURIComponent(owlAvatarSvg(seed))}`;
  cache.set(seed, url);
  return url;
}

/**
 * The colour `seed`'s owl is painted on, as `#rrggbb`. Normalises through
 * `avatarSeed` first: the renderer lowercases, and this once did not.
 */
export function generatedAvatarColor(nickname: string, worn?: string | null): string | undefined {
  const seed = avatarSeed(nickname);
  if (!seed) return undefined;
  const look = decodeWorn(worn);
  return look ? owlAvatarColour(seed, wornToOptions(look)) : owlAvatarColour(seed);
}

/**
 * A data URI for `seed`'s owl wearing `look`. Keyed on both — a cache keyed on
 * the seed alone hands back whatever they were wearing first.
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
 * What to show for a user: the owl they designed, then a picture they uploaded,
 * then the owl their name draws. Clearing the string is part of going back.
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

