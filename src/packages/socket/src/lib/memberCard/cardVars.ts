/**
 * The attributes and CSS variables a card root carries, from its style and the owl's
 * colour. The same steps as the mockup's cardStyle(), so the two draw alike.
 */

import type { CardStyle } from "./cardStyle.ts";
import { bandColours, type CardColourPick, fullColours, oklch, owlGradient } from "./colour.ts";
import { cardPattern } from "./patterns.ts";

export interface CardVars {
  attrs: Record<string, string>;
  vars: Record<string, string>;
  /** Muted text on the card, the lowest it gets. Only when the card is coloured whole. */
  contrast?: number;
}

const PATTERN_INPUTS = {
  owl: "var(--owl)",
  accent: "var(--m-accent)",
  surface: "var(--gryt-surface)",
  line: "var(--pat-color)",
};

export function cardVars(style: CardStyle, owlHex: string): CardVars {
  const pattern = cardPattern(style.pattern).render(PATTERN_INPUTS);
  const vars: Record<string, string> = {};
  if (pattern.image) vars["--pat-img"] = pattern.image;
  if (pattern.size) vars["--pat-size"] = pattern.size;
  if (pattern.base) vars["--base"] = pattern.base;

  const col: CardColourPick | null =
    style.fill !== "owl" && style.c1
      ? { mode: style.fill, c1: style.c1, c2: style.c2 ?? style.c1, angle: style.angle }
      : null;

  if (style.colours === "card") {
    const use = col ?? owlGradient(owlHex);
    const f = fullColours(use);
    const onCard = style.cover === "card";
    const pat = f.dark
      ? `oklch(20% 0.02 ${f.hue} / ${onCard ? 0.09 : 0.2})`
      : `oklch(99% 0.005 ${f.hue} / ${onCard ? 0.1 : 0.22})`;
    const tint = (pct: number) => `color-mix(in oklch, ${f.ink} ${pct}%, transparent)`;
    return {
      attrs: {
        "data-fc": "1",
        "data-cover": style.cover,
        "data-fade": style.fade === "banner" ? "full" : "bottom",
        "data-contrast": f.worst.toFixed(1),
      },
      vars: {
        ...vars,
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
        "--pat-color": pat,
        "--band": "transparent",
      },
      contrast: f.worst,
    };
  }

  if (col) {
    const k = bandColours(col);
    return {
      attrs: { "data-cc": "1" },
      vars: {
        ...vars,
        "--m-hue": String(k.hue),
        "--owl": col.c1,
        "--base": k.base,
        "--pat-color": k.pat,
        "--band": k.band,
        "--band-bg": k.bandBg,
        "--band-ink": k.ink,
        "--band-btn-ink": k.btnInk,
      },
    };
  }

  return { attrs: {}, vars: { ...vars, "--m-hue": String(Math.round(oklch(owlHex).H)), "--owl": owlHex } };
}
