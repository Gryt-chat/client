/**
 * A generated avatar for anyone who has not set one, and an icon for any server
 * that has not either.
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
 * Moods and Planets are both CC0, so nothing here has to be credited and nobody
 * running their own Gryt inherits an attribution obligation they did not choose.
 * Several of DiceBear's nicer styles are CC BY, which would have meant carrying
 * a credit line into every deployment.
 *
 * These come from @dicebear/styles rather than @dicebear/collection. Collection
 * stopped at 9.4.3 and pins core to ^9 — which is why an earlier attempt at
 * "just take the latest core" ended up with a working library and zero styles.
 * The style definitions moved to their own package for core 10, and that is
 * where the styles that are not in collection at all, these two included, live.
 */

import { Avatar, Style } from "@dicebear/core";
import moodsDefinition from "@dicebear/styles/moods.json";
import planetsDefinition from "@dicebear/styles/planets.json";

// Constructed once. A Style parses and validates its definition, and the docs
// are explicit that it is meant to be reused across avatars rather than rebuilt
// per render.
const moods = new Style(moodsDefinition);
const planets = new Style(planetsDefinition);

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
 * The colours an avatar can come out in — one pastel per tile hue.
 *
 * Derived from the hues rather than hand-picked so a face and the tile drawn
 * from it are the same colour by construction, instead of by two lists
 * agreeing. A hand-written palette was tried first, and four of its eight
 * entries snapped into the same orange band, which put six identical tiles in
 * a nine-person grid — the opposite of what tinting them is for.
 */
const AVATAR_COLOURS = TILE_HUES.map(pastel);

/**
 * Moods draws a filled face that fills the frame, so the colour a person reads
 * as "their" colour is the face, not the background behind it. Painting the
 * background as well would put a ring of a second colour around every avatar,
 * and tinting the tile from it would match the tile to a colour nobody can see.
 */
const TRANSPARENT = "00000000";

const cache = new Map<string, string>();
const colourCache = new Map<string, string>();

/**
 * The seed a person's avatar is drawn from: their nickname, normalised.
 *
 * Case and surrounding whitespace are dropped so "Sivert" and " sivert " are
 * one person. Everything else is kept — two nicknames that differ at all are
 * two faces.
 *
 * The nickname rather than the per-server id, which is what this used first.
 * The id gave a stable face across a rename, but it is issued per server, so
 * the same person arrived in every server looking like somebody else — nothing
 * about them had changed and yet they were unrecognisable. Nicknames travel.
 *
 * Two costs, deliberately accepted: two people using one nickname share a face,
 * and renaming yourself changes yours.
 */
export function avatarSeed(nickname: string | null | undefined): string | undefined {
  const trimmed = nickname?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

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

  const { svg, options } = new Avatar(moods, {
    seed,
    faceColor: AVATAR_COLOURS,
    backgroundColor: [TRANSPARENT],
  }).toJSON();

  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(seed, url);

  const face = options.faceColor?.[0];
  if (typeof face === "string") colourCache.set(seed, face);

  return url;
}

/**
 * The colour DiceBear drew `seed`'s face in, as `#rrggbb`.
 *
 * Voice tiles are tinted from the avatar's dominant colour, which the server
 * computes when someone uploads one. A generated avatar never goes near the
 * server, so without this the tile falls back to hashing the user id and lands
 * on a colour with no relationship to the face on it — a violet avatar on a
 * green tile. DiceBear reports the colour it picked, so this is the real one
 * rather than something sampled back out of the SVG.
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
  nickname: string | null | undefined,
): string | undefined {
  if (uploadedUrl) return uploadedUrl;
  const seed = avatarSeed(nickname);
  if (!seed) return undefined;
  return generatedAvatarUrl(seed);
}

/**
 * The same idea for a server that has not set an icon, in a style that is not
 * a face.
 *
 * Planets rather than Moods: a server is not a person, and drawing one as a
 * person is the thing that made a generated fallback look wrong here.
 *
 * Seeded on the server's name. A server is the thing it calls itself, and the
 * icon follows that: rename it and the planet changes with it, which is also
 * what makes the create form able to draw a server's icon before it exists.
 *
 * This used to seed on the host, port included, so that two servers on one
 * machine differed and nothing re-rolled when a name changed. Names carry that
 * weight less strictly — two servers both called "My Server" now draw the same
 * planet — but an address is not what anybody recognises a server by, and the
 * icon changing when you rename is the behaviour people expect.
 *
 * Callers that have no name yet (an address pasted before /info answers, an
 * invite before it is fetched) pass the host, so there is still something to
 * draw; it re-seeds once the name arrives.
 */
export function generatedServerIconUrl(seed: string): string {
  const key = `server:${seed}`;
  const cached = cache.get(key);
  if (cached) return cached;

  // No background palette here. Planets brings its own night sky, and forcing
  // the tile pastels onto it would light the sky the same colour as somebody's
  // avatar for no reason.
  const svg = new Avatar(planets, { seed }).toString();

  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
}

/** A server's own icon if it has one, otherwise one generated from its name. */
export function resolveServerIconSrc(
  iconUrl: string | null | undefined,
  seed: string | null | undefined,
): string | undefined {
  if (iconUrl) return iconUrl;
  if (!seed) return undefined;
  return generatedServerIconUrl(seed);
}
