/**
 * Ready-made card styles, by id. Adding one is a new entry here; the settings page
 * lists them in this order, and the swatch is drawn from the style itself.
 */

import { type CardStyle, DEFAULT_CARD_STYLE } from "./cardStyle.ts";
import { CARD_PATTERNS } from "./patterns.ts";

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

/** A colour from a hue, saturation and lightness, as #rrggbb. */
function hsl(h: number, sat: number, light: number): string {
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Scatter patterns that need a pick of their own are left to the person. */
const RANDOM_PATTERNS = CARD_PATTERNS.filter((p) => p.kind !== "none" && p.id !== "icon").map((p) => p.id);

/** A card style for the Surprise me button. Colours are kept in a range that reads well. */
export function randomCardStyle(random: () => number = Math.random): CardStyle {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const hue = Math.floor(random() * 360);
  const light = 0.35 + random() * 0.3;
  const gradient = random() < 0.6;
  const style: CardStyle = {
    ...DEFAULT_CARD_STYLE,
    fill: gradient ? "gradient" : "solid",
    c1: hsl(hue, 0.55 + random() * 0.35, light),
    angle: Math.floor(random() * 360),
    pattern: random() < 0.8 ? pick(RANDOM_PATTERNS) : "none",
    cover: random() < 0.5 ? "card" : "banner",
    pScale: 70 + Math.floor(random() * 90),
    pRotate: pick([0, 0, 15, 30, 45, 90]),
  };
  if (gradient) style.c2 = hsl((hue + 30 + random() * 120) % 360, 0.5 + random() * 0.4, 0.25 + random() * 0.35);
  return style;
}
