/** A pattern.monster tile as the card draws it, baked by scripts/card-patterns.mjs. */
export interface Tile {
  id: string;
  mode: "fill" | "stroke" | "round";
  /** The tile in its own units. */
  width: number;
  height: number;
  /** How wide one repeat is drawn on the card, in CSS pixels, before the member scales it. */
  tile: number;
  /** Stroke width in tile units; ignored for `fill`. */
  stroke: number;
  /** Path elements, back to front. */
  layers: readonly string[];
}

export interface TileIndexEntry {
  id: string;
  name: string;
  group: string;
}
