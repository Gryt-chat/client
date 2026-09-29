/**
 * The attributes and CSS variables a card root carries, from its style and the owl's
 * colour. The same steps as the mockup's cardStyle(), so the two draw alike.
 */

import type { CardStyle } from "./cardStyle.ts";
import { bandColours, blend, type CardColourPick, contrast, fullColours, hexOf, lumOf, oklch, okToRgb, owlGradient } from "./colour.ts";
import type { Tile } from "./patterns/tileTypes.ts";
import type { PatternMark } from "./patternSvg.ts";
import { patternLayers } from "./patternSvg.ts";

export interface CardVars {
  attrs: Record<string, string>;
  vars: Record<string, string>;
  /** Muted text on the card, the lowest it gets. Only when the card is coloured whole. */
  contrast?: number;
  /** The pattern's ink and strength as drawn, after the readability limit. */
  patternInk: string;
  patternAlpha: number;
}

export interface CardVarsOptions {
  appearance: "light" | "dark";
  /** Seeds a scatter pattern when the style has no shuffle of its own. */
  seed: number;
  tile?: Tile;
  mark?: PatternMark;
}

const CSS_COLOURS = { owl: "var(--owl)", accent: "var(--m-accent)", surface: "var(--gryt-surface)" };

/** Small text needs this much on whatever a pattern leaves under it. */
export const PATTERN_TEXT_CONTRAST = 4.5;

const hexAt = (L: number, C: number, H: number) => hexOf(okToRgb(L, C, H));

/**
 * The strongest a pattern can be before muted text on the card drops under 4.5:1,
 * checked on both ends of the card and its middle. `wanted` is returned when it fits.
 */
export function readablePatternAlpha(surfaces: readonly string[], ink: string, mutedHex: string, wanted: number): number {
  const mutedY = lumOf(mutedHex);
  const fits = (a: number) => surfaces.every((s) => contrast(lumOf(blend(s, ink, a)), mutedY) >= PATTERN_TEXT_CONTRAST);
  let a = wanted;
  while (a > 0 && !fits(a)) a = Math.max(0, a - 0.005);
  return a;
}

export function cardVars(style: CardStyle, owlHex: string, opts: CardVarsOptions): CardVars {
  const col: CardColourPick | null =
    style.fill !== "owl" && style.c1 ? { mode: style.fill, c1: style.c1, c2: style.c2 ?? style.c1, angle: style.angle } : null;
  const draw = (ink: string, alpha: number) => {
    const layers = patternLayers(
      style.pattern,
      {
        ink,
        alpha,
        scale: style.pScale / 100,
        rotate: style.pRotate,
        fade: style.pFade,
        seed: style.pSeed ?? opts.seed,
        tile: opts.tile,
        mark: opts.mark,
      },
      CSS_COLOURS,
    );
    const vars: Record<string, string> = {};
    if (layers.image) vars["--pat-img"] = layers.image;
    if (layers.base) vars["--base"] = layers.base;
    return vars;
  };
  const wantedAlpha = (own: number) => (style.pOpacity !== undefined ? style.pOpacity / 100 : own);

  if (style.colours === "card") {
    const use = col ?? owlGradient(owlHex);
    const f = fullColours(use);
    const onCard = style.cover === "card";
    const ownInk = f.dark ? hexAt(0.2, 0.02, f.hue) : hexAt(0.99, 0.005, f.hue);
    const ink = style.pInk ?? ownInk;
    const alpha = readablePatternAlpha([...f.ends, f.mid], ink, f.mutedHex, wantedAlpha(f.dark ? (onCard ? 0.09 : 0.2) : onCard ? 0.1 : 0.22));
    const tint = (pct: number) => `color-mix(in oklch, ${f.ink} ${pct}%, transparent)`;
    return {
      attrs: {
        "data-fc": "1",
        "data-cover": style.cover,
        "data-fade": style.fade === "banner" ? "full" : "bottom",
        "data-contrast": f.worst.toFixed(1),
      },
      vars: {
        ...draw(ink, alpha),
        colorScheme: f.dark ? "light" : "dark",
        "--fc-bg": f.bg,
        "--fc-mid": f.mid,
        "--gryt-text": f.ink,
        "--gryt-muted": f.muted,
        "--gryt-surface": f.mid,
        "--gryt-bg": f.mid,
        "--gryt-surface-raised": tint(9),
        "--gryt-surface-hover": tint(17),
        "--gryt-border": tint(22),
        "--gryt-accent": f.ink,
        "--gryt-on-accent": f.mid,
        "--gryt-danger": f.ink,
        "--m-accent": f.ink,
        "--m-ink": f.mid,
        "--m-hue": String(f.hue),
        "--owl": use.c1,
        "--base": f.raw,
        "--band": "transparent",
      },
      contrast: f.worst,
      patternInk: ink,
      patternAlpha: alpha,
    };
  }

  if (col) {
    const k = bandColours(col);
    const h1 = oklch(col.c1).H;
    const rawDark = (oklch(col.c1).L + oklch(col.c2 ?? col.c1).L) / 2 >= 0.6;
    const ink = style.pInk ?? (rawDark ? hexAt(0.2, 0.02, h1) : hexAt(0.98, 0.01, h1));
    const alpha = wantedAlpha(rawDark ? 0.28 : 0.3);
    return {
      attrs: { "data-cc": "1" },
      vars: {
        ...draw(ink, alpha),
        "--m-hue": String(k.hue),
        "--owl": col.c1,
        "--base": k.base,
        "--band": k.band,
        "--band-bg": k.bandBg,
        "--band-ink": k.ink,
        "--band-btn-ink": k.btnInk,
      },
      patternInk: ink,
      patternAlpha: alpha,
    };
  }

  // The owl's own colour at the theme's lightness, which is what --m-accent works out to.
  const hue = oklch(owlHex).H;
  const dark = opts.appearance === "dark";
  const ink = style.pInk ?? hexAt(dark ? 0.76 : 0.52, dark ? 0.13 : 0.14, hue);
  const alpha = wantedAlpha(0.7);
  return {
    attrs: {},
    vars: { ...draw(ink, alpha), "--m-hue": String(Math.round(hue)), "--owl": owlHex },
    patternInk: ink,
    patternAlpha: alpha,
  };
}
