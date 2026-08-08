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

import { notionists, shapes } from "@dicebear/collection";
import { createAvatar } from "@dicebear/core";

/**
 * The hues a voice tile is drawn in.
 *
 * A curated set rather than the full wheel: free hue lands in the yellow-green
 * band often enough to matter, and those come out muddy at the lightness a tile
 * needs. Meet's own tiles are clearly drawn from a fixed palette too.
 *
 * It lives here, next to the avatars, because the two have to be the same list
 * — see BACKGROUND_COLOURS.
 */
export const TILE_HUES = [280, 24, 170, 330, 210, 140, 350, 45, 260, 195];

/** A pastel at `hue`, light enough to draw a face on. */
function pastel(hue: number): string {
  const c = 0.24;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = 0.68;

  const [r, g, b] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];

  return [r, g, b]
    .map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Backgrounds are not optional.
 *
 * Notionists renders transparent, which on a dark UI is a head floating in the
 * page. It also matters beyond looks: voice tiles are tinted from the avatar's
 * dominant colour, and a transparent image gives that nothing to sample.
 *
 * One pastel per tile hue, derived rather than hand-picked, so an avatar's
 * background and the tile drawn from it are the same colour by construction
 * instead of by two lists agreeing. The first attempt was a hand-written
 * palette of pleasant pastels, and four of its eight entries sat in the same
 * orange band once snapped — a grid where six of nine tiles were the same
 * colour, which is the opposite of what tinting them is for.
 */
const BACKGROUND_COLOURS = TILE_HUES.map(pastel);

const cache = new Map<string, string>();
const colourCache = new Map<string, string>();

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

  const result = createAvatar(notionists, {
    seed,
    backgroundColor: BACKGROUND_COLOURS,
    // Notionists draws head-and-shoulders with room around it. Avatars here are
    // circular and small, so without this the face sits too far in to read.
    scale: 130,
    radius: 50,
  });

  const { svg, extra } = result.toJson();
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(seed, url);

  const background = extra.primaryBackgroundColor;
  if (typeof background === "string") colourCache.set(seed, background);

  return url;
}

/**
 * The background colour DiceBear picked for `seed`, as `#rrggbb`.
 *
 * Voice tiles are tinted from the avatar's dominant colour, which the server
 * computes when someone uploads one. A generated avatar never goes near the
 * server, so without this the tile falls back to hashing the user id and lands
 * on a colour with no relationship to the face on it — a violet avatar on a
 * green tile. DiceBear reports its own choice, so this is the real colour
 * rather than one sampled back out of the SVG.
 */
export function generatedAvatarColor(seed: string): string | undefined {
  if (!colourCache.has(seed)) generatedAvatarUrl(seed);
  return colourCache.get(seed);
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

/**
 * The same idea for a server that has not set an icon, in a style that is not
 * a face.
 *
 * Shapes rather than Notionists: a server is not a person, and drawing one as
 * a person is the thing that made a generated fallback look wrong here. It is
 * also CC0, so it carries the same "nobody inherits an attribution
 * obligation" property the user avatars were chosen for.
 *
 * Seeded on the host, port included, because that is what identifies a server
 * to a client before it has told you anything about itself — and two servers
 * on one machine should not be the same icon. The cost is that a server moving
 * to a new address gets a new icon, which is the same cost as the certificate
 * pin and, like it, only affects servers that never set an icon.
 */
export function generatedServerIconUrl(host: string): string {
  const key = `server:${host}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const svg = createAvatar(shapes, {
    seed: host,
    radius: 50,
  }).toString();

  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
}

/** A server's own icon if it has one, otherwise a generated one. */
export function resolveServerIconSrc(
  iconUrl: string | null | undefined,
  host: string | null | undefined,
): string | undefined {
  if (iconUrl) return iconUrl;
  if (!host) return undefined;
  return generatedServerIconUrl(host);
}
