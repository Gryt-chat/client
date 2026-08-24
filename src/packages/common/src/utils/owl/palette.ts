/**
 * The colours an owl comes in.
 *
 * Derived from TILE_HUES rather than hand-picked, and that is load-bearing
 * rather than tidy. A voice tile is tinted from its occupant's avatar colour,
 * and the tint snaps to the nearest entry in that list — so a palette built on
 * anything else gets rounded to a hue it was never designed around. Building
 * the palettes from the list makes the snap exact by construction.
 *
 * The hand-written palette this replaced had four of its eight entries land in
 * the same orange band, which put six identical tiles in a nine-person grid.
 */

import type { OwlPalette, PaletteName, PaletteScheme } from "./types";

/**
 * The hues a voice tile is drawn in.
 *
 * A curated set rather than the full wheel: free hue lands in the yellow-green
 * band often enough to matter, and those come out muddy at the lightness a
 * tile needs. Meet's own tiles are drawn from a fixed palette too.
 */
export const TILE_HUES = [280, 24, 170, 330, 210, 140, 350, 45, 260, 195];

export const PALETTE_NAMES: PaletteName[] = [
  "violet",
  "amber",
  "teal",
  "pink",
  "blue",
  "green",
  "red",
  "gold",
  "indigo",
  "cyan",
];

export const PALETTE_SCHEMES: PaletteScheme[] = ["night", "day", "dusk"];

const HUE_BY_NAME: Record<PaletteName, number> = {
  violet: 280,
  amber: 24,
  teal: 170,
  pink: 330,
  blue: 210,
  green: 140,
  red: 350,
  gold: 45,
  indigo: 260,
  cyan: 195,
};

function hex(value: number): string {
  const byte = Math.max(0, Math.min(255, Math.round(value * 255)));
  return byte.toString(16).padStart(2, "0");
}

/** `#rrggbb` for an HSL triple, with h in degrees and s/l in percent. */
export function hsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const light = l / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  const [r, g, b] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];

  return "#" + hex(r + m) + hex(g + m) + hex(b + m);
}

/** Degrees between two hues, the short way round. */
function apart(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * The hue the scarf and the pilot frames are drawn in.
 *
 * Two poles — amber and a cold blue — and each palette takes whichever is
 * further from its own hue. One line, and it cannot fail the way a fixed warm
 * accent does: a gold owl never ends up in a gold scarf, and a teal one gets
 * the amber the drawings use.
 */
function farHue(h: number): number {
  return apart(h, 34) >= apart(h, 202) ? 34 : 202;
}

/**
 * The three ways an owl sits against its background.
 *
 * All three come off the painted references. `night` is the pale owl on a deep
 * field; `day` is the dark owl on a bright one; `dusk` is the pale owl on a
 * saturated one, which needs a darker wing than the other two or the whole
 * bird flattens into the background.
 *
 * The face runs warm in every scheme — the hue offsets below are why a teal owl
 * still has a cream face rather than a teal one, and they are what stops ten
 * palettes reading as one palette at ten temperatures.
 *
 * The plate is also lighter against the body here than on the artboard. At the
 * size a member list draws an avatar, the reference's four points of lightness
 * between the two disappear and the owl loses its face.
 *
 * `trim` stays inside the palette's own hue, because that is what the drawn
 * accessories do — the bow tie, the winter hat and the headphone pads are the
 * bird's own colour at a different lightness, not a contrasting one. Which
 * lightness depends on the scheme: a dark owl needs a light bow tie and a pale
 * owl a dark one, and getting that backwards is a smudge under the chin.
 */
export function owlPalette(name: PaletteName, scheme: PaletteScheme): OwlPalette {
  const h = HUE_BY_NAME[name];
  const far = farHue(h);
  const gold = hsl(far, 58, 50);
  const goldDeep = hsl(far - 2, 56, 41);

  if (scheme === "night") {
    return {
      background: hsl(h, 36, 26),
      body: hsl(h + 10, 48, 67),
      face: hsl(h + 20, 52, 88),
      accent: hsl(h, 38, 24),
      wing: hsl(h + 4, 38, 53),
      trimLight: hsl(h + 6, 40, 60),
      trim: hsl(h + 2, 38, 42),
      trimDeep: hsl(h + 4, 40, 31),
      trimSoft: hsl(h + 18, 44, 91),
      gold,
      goldDeep,
    };
  }

  if (scheme === "day") {
    return {
      background: hsl(h, 60, 64),
      body: hsl(h - 4, 33, 30),
      face: hsl(h + 18, 52, 87),
      accent: hsl(h - 8, 34, 22),
      wing: hsl(h - 4, 36, 22),
      trimLight: hsl(h + 6, 38, 70),
      trim: hsl(h + 2, 34, 55),
      trimDeep: hsl(h + 4, 36, 41),
      trimSoft: hsl(h + 18, 40, 88),
      gold,
      goldDeep,
    };
  }

  return {
    background: hsl(h, 54, 60),
    body: hsl(h + 6, 56, 78),
    face: hsl(h + 22, 66, 93),
    accent: hsl(h - 10, 40, 29),
    wing: hsl(h - 8, 34, 45),
    trimLight: hsl(h + 6, 38, 62),
    trim: hsl(h + 2, 36, 45),
    trimDeep: hsl(h + 4, 38, 33),
    trimSoft: hsl(h + 20, 48, 93),
    gold,
    goldDeep,
  };
}

/** Every palette, for a picker or a contact sheet. */
export function allOwlPalettes(): {
  name: PaletteName;
  scheme: PaletteScheme;
  palette: OwlPalette;
}[] {
  const out: { name: PaletteName; scheme: PaletteScheme; palette: OwlPalette }[] = [];
  for (const name of PALETTE_NAMES) {
    for (const scheme of PALETTE_SCHEMES) {
      out.push({ name, scheme, palette: owlPalette(name, scheme) });
    }
  }
  return out;
}
