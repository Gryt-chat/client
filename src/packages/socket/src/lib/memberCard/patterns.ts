/**
 * Card patterns, by id. The id is stored on servers and in style codes, so it never
 * changes; a new pattern is a new entry. Unknown ids read as "none".
 */

import { TILE_INDEX } from "./patterns/tileIndex.generated.ts";

/**
 * How a pattern is drawn. `base` replaces the banner's fill, `svg` and `tile` lay lines
 * over it, and `scatter` strews a mark across it.
 */
export type PatternKind = "none" | "base" | "svg" | "tile" | "scatter";

export interface CardPattern {
  id: string;
  name: string;
  /** The heading it sits under in Edit my card. */
  group: string;
  kind: PatternKind;
}

/** The headings, in the order Edit my card shows them. */
export const PATTERN_GROUPS = ["Classic", "Gryt", "Lines", "Waves", "Grids", "Shapes", "Decorative"] as const;

export const CARD_PATTERNS: readonly CardPattern[] = [
  { id: "none", name: "None", group: "Classic", kind: "none" },
  { id: "gradient", name: "Gradient", group: "Classic", kind: "base" },
  { id: "dots", name: "Dots", group: "Classic", kind: "svg" },
  { id: "contours", name: "Contours", group: "Classic", kind: "svg" },
  { id: "weave", name: "Weave", group: "Classic", kind: "svg" },
  { id: "dusk", name: "Dusk", group: "Classic", kind: "base" },
  { id: "gryt-faces", name: "Gryt faces", group: "Gryt", kind: "scatter" },
  { id: "my-owl", name: "My owl", group: "Gryt", kind: "scatter" },
  { id: "icon", name: "An icon", group: "Gryt", kind: "scatter" },
  ...TILE_INDEX.map((t) => ({ id: t.id, name: t.name, group: t.group, kind: "tile" as const })),
];

const BY_ID = new Map(CARD_PATTERNS.map((p) => [p.id, p]));

/** The id as stored, or "none" for anything this build does not know. */
export function patternId(value: unknown): string {
  return typeof value === "string" && BY_ID.has(value) ? value : "none";
}

export function cardPattern(id: unknown): CardPattern {
  return BY_ID.get(patternId(id)) ?? CARD_PATTERNS[0];
}

/** Whether size, rotation, strength and the rest mean anything for this pattern. */
export function isTunable(id: unknown): boolean {
  const kind = cardPattern(id).kind;
  return kind === "svg" || kind === "tile" || kind === "scatter";
}
