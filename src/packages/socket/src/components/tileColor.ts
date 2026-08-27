/**
 * The colour a voice tile is painted, derived from the avatar on it.
 *
 * Its own module so `scripts/check-tile-contrast.mjs` can import it: white
 * nickname text sits on these, the ceiling of the lightness band is therefore a
 * contrast decision, and a test that reimplements the maths instead of calling
 * it proves nothing. speakingIndicator.ts resolves `@/common`, which is a
 * bundler alias and not a node one, so importing it from a script is not
 * possible — and a check that cannot run against the real function is how the
 * first version of that test passed with the clamp deleted.
 *
 * Nothing here touches React or the avatar modules. It is hex in, `hsl()`
 * parts out.
 */

/** A tile's colour, as the three parts of an `hsl()`. */
export interface TileTint {
  hue: number;
  /** Percent. */
  sat: number;
  /** Percent, of the gradient's lighter centre. */
  light: number;
}

/* The band a tile is allowed to occupy.
 *
 * White nickname text sits on these, so the ceiling is a contrast floor rather
 * than a taste one — see check-tile-contrast. The floor keeps a near-black owl
 * from producing a tile that reads as a hole in the grid.
 */
const TILE_SAT = { min: 34, max: 62 };
const TILE_LIGHT = { min: 26, max: 40 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** WCAG relative luminance for an `hsl()`, via sRGB. */
function hslLuminance(hue: number, sat: number, light: number): number {
  const s = sat / 100;
  const l = light / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] =
    hue < 60 ? [c, x, 0] :
    hue < 120 ? [x, c, 0] :
    hue < 180 ? [0, c, x] :
    hue < 240 ? [0, x, c] :
    hue < 300 ? [x, 0, c] : [c, 0, x];

  const channel = (v: number) => {
    const n = v + m;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The nickname is white, and it sits on the tile at full opacity. */
const WHITE_TEXT_CONTRAST = 4.5;

/**
 * The lightest this hue may be and still carry white text.
 *
 * A single ceiling cannot do this job: at the same lightness, yellow is roughly
 * twice as bright as blue. The old tile was a fixed `hsl(h 48% 42%)`, which is
 * 6.7:1 on blue and **2.8:1 on yellow** — so the yellow tiles have been failing
 * AA all along, and quietly, because nothing measured them.
 *
 * Bisected rather than tabulated so it follows the saturation it is actually
 * given. Twenty rounds is well under a tenth of a percent, and the whole thing
 * is a few multiplications on a value that changes when somebody's avatar does.
 */
export function maxLightForWhiteText(hue: number, sat: number): number {
  let low = 0;
  let high = 100;

  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    const contrast = 1.05 / (hslLuminance(hue, sat, mid) + 0.05);
    if (contrast >= WHITE_TEXT_CONTRAST) low = mid;
    else high = mid;
  }

  return low;
}

/**
 * The avatar's own colour, as a tile.
 *
 * This used to snap the hue to `TILE_HUES` and paint it at one fixed
 * saturation and lightness, on the reasoning that an arbitrary hue at a fixed
 * lightness lands in the olive band often enough to look broken. The reasoning
 * was sound and the conclusion was the wrong half: keeping the hue and throwing
 * away the other two is what made tiles stop matching their owls.
 *
 * It collided, too. Guro's `#62d087` and Håkon's `#2a5a3a` are a bright green
 * and a dark green, and both snapped to hue 140 — one tile for two visibly
 * different birds, which is most of why the grid read as arbitrary (GRYT-648).
 *
 * So the colour is taken whole and banded instead. The hue is the avatar's
 * actual hue, and saturation and lightness are its own, held inside a range the
 * panel can carry — which answers the olive problem directly rather than by
 * discarding the information that would have avoided it.
 *
 * Still null for a grey avatar, whose hue is rounding noise, and for anything
 * malformed. The caller falls back to the id hash.
 */
export function tintFromAvatarColor(hex: string | null | undefined): TileTint | null {
  const hue = hueFromAvatarColor(hex);
  if (hue === null) return null;

  const match = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!match) return null;

  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const delta = max - min;
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));

  const tileSat = clamp(sat * 100, TILE_SAT.min, TILE_SAT.max);

  return {
    hue,
    sat: tileSat,
    light: clamp(
      light * 100,
      TILE_LIGHT.min,
      Math.min(TILE_LIGHT.max, maxLightForWhiteText(hue, tileSat)),
    ),
  };
}

/**
 * The avatar's hue, unsnapped.
 *
 * Snapping to `TILE_HUES` was what `tintFromAvatarColor` replaced; this is the
 * hue as it is. `hueFromId` still snaps, because a hash has no colour to
 * respect and the palette is the whole point there.
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

  return (hue * 60 + 360) % 360;
}
