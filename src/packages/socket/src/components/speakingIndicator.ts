/**
 * One implementation of "this person is talking", for every place that shows it.
 *
 * The voice tile and the sidebar's connected-user row both read the same
 * `clientsSpeaking` record, but they used to draw it differently — a flush 2px
 * accent outline in the sidebar, a 2.5px one on the tile — so the same fact
 * looked like two different things depending on where you were looking. The
 * geometry lives here now, and both call it.
 */

import { generatedAvatarColor, TILE_HUES } from "@/common";

export { TILE_HUES };

/**
 * A stable hue per person, derived from their id.
 *
 * The server does send a per-user `color`, but the client overwrites every one
 * of them with a flat gray in the members:list handler, so there is nothing
 * usable to read. Deriving it here means the same person is the same colour on
 * every client without the server having to agree, and it cannot drift out of
 * sync with whatever the sidebar decides to do.
 *
 * `avatarColor` on the member is the better source where it exists — see
 * hueFromAvatarColor.
 */
export function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return TILE_HUES[Math.abs(hash) % TILE_HUES.length];
}

import {
  hueFromAvatarColor,
  maxLightForWhiteText,
  type TileTint,
  tintFromAvatarColor,
} from "./tileColor";

export type { TileTint };
export { hueFromAvatarColor, tintFromAvatarColor };

/**
 * A person's hue, in the same order of precedence `resolveAvatarSrc` picks the
 * picture: the owl they designed, then a picture they uploaded, then the owl
 * their name draws, then the id hash.
 *
 * The designed owl has to come first, and it did not. Saving a design uploads a
 * PNG as well — that is what an old client shows — so anybody with a designed
 * owl also has an `avatarFileId`, and therefore a server-computed
 * `dominant_color` sampled off that raster. Reading it first meant the tile was
 * tinted by whatever the sampler happened to land on, which for an owl is the
 * large pale face rather than the hood: a red owl on a yellow tile, wrong in a
 * way nothing downstream could correct.
 *
 * `owl` is a nickname and a worn string rather than reusing `id`, because the
 * two are not interchangeable. `id` is the hash seed and callers pass a
 * serverUserId for it; `generatedAvatarColor` needs the nickname the avatar
 * renderer actually drew from.
 *
 * The generated case still matters. The tint exists to make a tile recognisably
 * that person's, and a generated avatar is what most people have — falling
 * straight through to the id hash put a violet face on a green tile and made the
 * tinting look arbitrary, which is the one thing it must not look like.
 * hueFromId stays as the last resort, for a caller that has no seed to generate
 * from.
 */
export function tileTint(
  id: string,
  avatarColor?: string | null,
  owl?: { nickname?: string | null; worn?: string | null },
): TileTint {
  const fromAvatar =
    (owl?.worn
      ? tintFromAvatarColor(generatedAvatarColor(owl.nickname ?? "", owl.worn))
      : null) ??
    tintFromAvatarColor(avatarColor) ??
    tintFromAvatarColor(generatedAvatarColor(id));

  if (fromAvatar) return fromAvatar;

  /* No colour to respect — a grey avatar, or a caller with nothing to generate
     from. The palette is the right answer here, and these are the numbers every
     tile used before any of this. */
  const hue = hueFromId(id);
  return { hue, sat: 48, light: Math.min(42, maxLightForWhiteText(hue, 48)) };
}

/** The hue alone, for the speaking ring and anything else that only needs it. */
export function tileHue(
  id: string,
  avatarColor?: string | null,
  owl?: { nickname?: string | null; worn?: string | null },
): number {
  return tileTint(id, avatarColor, owl).hue;
}

/**
 * Meet's tiles are a lighter centre falling off to a deeper edge. Two stops of
 * the same hue rather than a flat fill — flat reads as a coloured rectangle,
 * the falloff reads as a tile with someone in it.
 */
/**
 * The gradient for a tint that has already been worked out.
 *
 * Exists so a caller that needs the tile, the badge and the ring can derive all
 * three from one `tileTint` rather than calling it once per use. Three calls
 * meant three chances to pass a different id, and VoiceParticipantCard took
 * two of them — the tile was tinted from `serverUserId` while the avatar beside
 * it was drawn from the nickname, so every fake participant's tile was the
 * colour of an owl belonging to somebody called `fake-0` (GRYT-648).
 */
export function tileGradientFrom({ hue, sat, light }: TileTint): string {

  /* The edge keeps its old relationship to the centre — a little more
     saturated, about half as light — so the falloff still reads as a tile with
     someone in it rather than a flat rectangle. */
  const edgeSat = Math.min(100, sat + 7);
  const edgeLight = Math.round(light * 0.48);

  return `radial-gradient(circle at 50% 42%, hsl(${hue} ${Math.round(sat)}% ${Math.round(light)}%), hsl(${hue} ${Math.round(edgeSat)}% ${edgeLight}%) 75%)`;
}

export function tileGradient(
  id: string,
  avatarColor?: string | null,
  owl?: { nickname?: string | null; worn?: string | null },
): string {
  return tileGradientFrom(tileTint(id, avatarColor, owl));
}

/**
 * The speaking ring's thickness, in px.
 *
 * On a video tile it is drawn with a negative outline-offset. A tile fills its
 * grid cell exactly, so an outline at the default offset is painted outside the
 * cell — into the 12px gap between tiles, or clipped away entirely at the
 * panel's edge. Pulling it inward by its own width keeps it on the tile and
 * lets it follow the corner radius.
 */
export const SPEAKING_RING = 2.5;

/**
 * The ring itself, as a style for an avatar.
 *
 * Takes the person's hue rather than the accent, so it is their colour — which
 * since GRYT-65 is their avatar's. Offset by 2px so the ring sits just off the
 * image the way Meet's does, instead of looking like a border on it.
 */
export function speakingRingStyle(
  hue: number,
  isSpeaking: boolean,
  width: number = SPEAKING_RING,
): React.CSSProperties {
  return {
    outline: `${width}px solid`,
    outlineColor: isSpeaking ? `hsl(${hue} 65% 68%)` : "transparent",
    outlineOffset: 2,
    transition: "outline-color 0.1s ease",
    // Above the halo, which grows out from behind it.
    position: "relative",
    zIndex: 1,
  };
}
