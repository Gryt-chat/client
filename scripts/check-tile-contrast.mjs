/* eslint-env node */

/**
 * White text stays readable on every tile a person's avatar can produce. The band
 * is swept rather than argued about: every hue at its lightest (GRYT-648).
 */

import assert from "node:assert/strict";

import { tintFromAvatarColor } from "../src/packages/socket/src/components/tileColor.ts";

/** sRGB relative luminance, the WCAG definition. */
function luminance(r, g, b) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function hslToRgb(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function contrastWithWhite(h, s, l) {
  const [r, g, b] = hslToRgb(h, s, l);
  return 1.05 / (luminance(r, g, b) + 0.05);
}

/**
 * Every colour an avatar can be, through the real function. Reimplementing the
 * clamp passed with the clamp deleted from the module.
 */
function contrastOf({ hue, sat, light }) {
  return contrastWithWhite(hue, sat, light);
}

let worst = { ratio: Infinity, hex: "" };
let checked = 0;

for (let r = 0; r < 256; r += 17) {
  for (let g = 0; g < 256; g += 17) {
    for (let b = 0; b < 256; b += 17) {
      const hex =
        "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
      const tint = tintFromAvatarColor(hex);
      // Grey is refused by design; the caller falls back to the palette.
      if (!tint) continue;

      checked++;
      const ratio = contrastOf(tint);
      if (ratio < worst.ratio) worst = { ratio, hex };
    }
  }
}

assert.ok(checked > 1000, `only ${checked} colours produced a tint`);

assert.ok(
  worst.ratio >= 4.5,
  `white on the tile for ${worst.hex} is ${worst.ratio.toFixed(2)}:1, want 4.5:1`,
);

console.log(
  `Tile contrast checks passed — ${checked} colours, worst ${worst.ratio.toFixed(2)}:1 for ${worst.hex}`,
);
