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

/**
 * The palette entry nearest the avatar's own colour.
 *
 * Snapped rather than used directly, for the same reason hueFromId picks from a
 * list: the tile is drawn at a fixed lightness and saturation, and an arbitrary
 * hue put through those lands in the olive band often enough to look broken.
 * Snapping keeps the person's colour recognisable while every tile stays a
 * colour the panel was designed around.
 *
 * Returns null rather than a hue for anything the snap would misrepresent — a
 * malformed value, or a grey avatar, whose hue is whatever rounding noise it
 * happens to carry. The caller falls back to the id hash, which is what every
 * tile looked like before this existed.
 */
export function hueFromAvatarColor(hex: string | null | undefined): number | null {
  if (!hex) return null;

  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;

  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  // Near-grey. Below this the hue is noise, and snapping it would hand someone
  // a saturated tile that has nothing to do with their avatar.
  if (delta < 0.08) return null;

  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;

  hue = (hue * 60 + 360) % 360;

  let nearest = TILE_HUES[0];
  let best = Infinity;
  for (const candidate of TILE_HUES) {
    // Around the wheel, so 350 and 24 are 34 apart rather than 326.
    const diff = Math.abs(((candidate - hue + 540) % 360) - 180);
    if (diff < best) {
      best = diff;
      nearest = candidate;
    }
  }
  return nearest;
}

/**
 * A person's hue: their avatar's colour where there is one, and the generated
 * avatar's own background where there is not.
 *
 * The generated case matters more than it looks. The tint exists to make a
 * tile recognisably that person's, and a generated avatar is what most people
 * have — falling straight through to the id hash put a violet face on a green
 * tile and made the tinting look arbitrary, which is the one thing it must not
 * look like. hueFromId stays as the last resort, for a caller that has no seed
 * to generate from.
 */
export function tileHue(id: string, avatarColor?: string | null): number {
  return (
    hueFromAvatarColor(avatarColor) ??
    hueFromAvatarColor(generatedAvatarColor(id)) ??
    hueFromId(id)
  );
}

/**
 * Meet's tiles are a lighter centre falling off to a deeper edge. Two stops of
 * the same hue rather than a flat fill — flat reads as a coloured rectangle,
 * the falloff reads as a tile with someone in it.
 */
export function tileGradient(id: string, avatarColor?: string | null): string {
  const h = tileHue(id, avatarColor);
  return `radial-gradient(circle at 50% 42%, hsl(${h} 48% 42%), hsl(${h} 55% 20%) 75%)`;
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
