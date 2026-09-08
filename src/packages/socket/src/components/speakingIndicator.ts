/**
 * One implementation of "this person is talking", for every place that shows it.
 * The tile and the sidebar row drew it differently; the geometry lives here now.
 */

import { generatedAvatarColor, TILE_HUES } from "@/common";

export { TILE_HUES };

/**
 * A stable hue per person, derived from their id. The server's per-user `color`
 * is overwritten with grey in the members:list handler, so it is unusable.
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
 * A person's hue, in the same precedence `resolveAvatarSrc` picks the picture.
 * **The designed owl comes first**: `dominant_color` samples the pale face.
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
     from. These are the numbers every tile used before any of this. */
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
 * Meet's tiles are a lighter centre falling off to a deeper edge. Flat reads as a
 * coloured rectangle; the falloff reads as a tile with someone in it.
 */

/**
 * The gradient for a tint already worked out, so one `tileTint` serves the tile,
 * the badge and the ring. Three calls meant three chances at a different id.
 */
export function tileGradientFrom({ hue, sat, light }: TileTint): string {

  /* The edge keeps its old relationship to the centre — a little more saturated,
     about half as light — so the falloff still reads as a tile. */
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
 * The speaking ring's thickness, in px. Drawn with a negative outline-offset: at
 * the default it lands in the 12px gap between tiles, or is clipped at the edge.
 */
export const SPEAKING_RING = 2.5;

/**
 * The ring itself, as a style for an avatar. Takes the person's hue rather than
 * the accent, and is offset by 2px so it sits off the image, not on it.
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
