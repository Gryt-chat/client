/**
 * Ready-made card styles, by id. Adding one is a new entry here; the settings page
 * lists them in this order, and the swatch is drawn from the style itself.
 */

import { type CardStyle, DEFAULT_CARD_STYLE } from "./cardStyle.ts";

export interface BuiltinCardStyle {
  id: string;
  name: string;
  style: CardStyle;
}

const s = (over: Partial<CardStyle>): CardStyle => ({ ...DEFAULT_CARD_STYLE, ...over });

export const BUILTIN_CARD_STYLES: readonly BuiltinCardStyle[] = [
  { id: "owl", name: "Owl", style: s({}) },
  {
    id: "harbour",
    name: "Harbour",
    style: s({ fill: "gradient", c1: "#1d4e89", c2: "#3fb6a8", angle: 135, pattern: "contours" }),
  },
  {
    id: "signal",
    name: "Signal",
    style: s({ fill: "solid", c1: "#ffd400", c2: "#ffd400", pattern: "dots", cover: "card" }),
  },
  {
    id: "night-shift",
    name: "Night shift",
    style: s({ fill: "gradient", c1: "#0b0b12", c2: "#5b2a86", angle: 160, pattern: "weave", fade: "banner" }),
  },
  {
    id: "ember",
    name: "Ember",
    style: s({ fill: "gradient", c1: "#ff7a1a", c2: "#7a1020", angle: 120, pattern: "gradient" }),
  },
];

/** The swatch beside a style's name: its own colours, or the app accent for the owl. */
export function styleSwatch(style: CardStyle): string {
  if (style.fill === "solid" && style.c1) return style.c1;
  if (style.fill === "gradient" && style.c1 && style.c2) return `linear-gradient(${style.angle}deg,${style.c1},${style.c2})`;
  return "var(--gryt-accent)";
}
