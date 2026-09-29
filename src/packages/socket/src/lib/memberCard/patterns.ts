/**
 * Card patterns, by id. The id is stored on servers and in style codes, so it never
 * changes; a new pattern is a new entry. Unknown ids read as "none".
 */

/** CSS colours a pattern draws with. The card passes its own variables in. */
export interface PatternInputs {
  /** The member's own colour. */
  owl: string;
  /** Their colour at the theme's lightness. */
  accent: string;
  /** The card's surface. */
  surface: string;
  /** The line colour, already contrast-checked against the card. */
  line: string;
}

/** Background layers. `base` replaces the plain fill, `image` goes over it. */
export interface PatternLayers {
  base?: string;
  image?: string;
  size?: string;
}

export interface CardPattern {
  id: string;
  name: string;
  render: (c: PatternInputs) => PatternLayers;
}

export const CARD_PATTERNS: readonly CardPattern[] = [
  { id: "none", name: "None", render: () => ({}) },
  {
    id: "gradient",
    name: "Gradient",
    render: (c) => ({
      base: `linear-gradient(135deg, ${c.owl} 10%, color-mix(in oklch, ${c.accent} 60%, ${c.surface}))`,
    }),
  },
  {
    id: "dots",
    name: "Dots",
    render: (c) => ({ image: `radial-gradient(${c.line} 1.5px, transparent 1.9px)`, size: "11px 11px" }),
  },
  {
    id: "contours",
    name: "Contours",
    render: (c) => ({
      image: `repeating-radial-gradient(circle at 78% 130%, transparent 0 9px, ${c.line} 9px 10.5px)`,
    }),
  },
  {
    id: "weave",
    name: "Weave",
    render: (c) => ({
      image:
        `repeating-linear-gradient(45deg, ${c.line} 0 2px, transparent 2px 12px), ` +
        `repeating-linear-gradient(-45deg, ${c.line} 0 2px, transparent 2px 12px)`,
      size: "auto, auto",
    }),
  },
  {
    id: "dusk",
    name: "Dusk",
    render: (c) => ({
      base:
        `linear-gradient(180deg, ${c.owl} 0%, color-mix(in oklch, ${c.owl} 45%, ${c.surface}) 72%, ` +
        `${c.surface} 100%)`,
    }),
  },
];

const BY_ID = new Map(CARD_PATTERNS.map((p) => [p.id, p]));

/** The id as stored, or "none" for anything this build does not know. */
export function patternId(value: unknown): string {
  return typeof value === "string" && BY_ID.has(value) ? value : "none";
}

export function cardPattern(id: unknown): CardPattern {
  return BY_ID.get(patternId(id)) ?? CARD_PATTERNS[0];
}
