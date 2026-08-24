/**
 * The vocabulary of an owl.
 *
 * What is deliberately not here is as much of the answer as what is. The body,
 * the wings, the face plate and the beak have no styles at all, and neither do
 * their proportions — every owl is the drawn owl, at the drawn size. An avatar
 * set whose silhouette varies is a face generator, and this is one character.
 *
 * What varies is the colour, the expression, whether it has ear tufts, and what
 * it is wearing.
 */

export type Seed = string | number;

/** Ear tufts. The drawn owl has them; some owls do not. */
export type EarStyle = "none" | "tufts";

/**
 * A part of the bird itself, as opposed to something it is wearing.
 *
 * Named so that a drawing can say which of them it replaces. An expression
 * brings its own eyes, so it hides the drawn ones rather than being painted
 * over them — see `hides` on Accessory.
 */
export type OwlPart = "earTufts" | "body" | "wings" | "face" | "eyes" | "beak";

/**
 * Where an accessory is worn. One per slot, drawn independently, so a hat and a
 * pair of glasses and a scarf are three separate rolls and can all turn up at
 * once.
 *
 * `expression` is a slot like the others rather than a special case, because it
 * behaves like one: it is a drawing, it is chosen by weight, and an owl can
 * come up without one. Coming up without one is not a face with no eyes — it is
 * the eyes the bird is drawn with.
 */
export type AccessorySlot = "expression" | "eyewear" | "head" | "neck" | "body";

/**
 * Where an accessory sits in the stack.
 *
 * The owl is drawn back to front as: field, ear tufts, body, wings, face plate,
 * eyes, beak. These name the gaps between those.
 *
 * `overEyes` is where spectacles go, and it is where they were drawn: the lens
 * is painted, so it hides the eye behind it. `overFace` is the other way round,
 * for a frame drawn as holes only, where the owl's own eyes land on top and the
 * expression shows through the glass.
 *
 * `overAll` is the top of the stack and where most things belong — a hat has to
 * cover the ear tufts, and a coat covers the bird, collar and all. `underFace`
 * and `behind` are the two escape hatches: something on the chest that the chin
 * should cover, and something that belongs behind the whole bird.
 *
 * Within one layer, accessories draw in slot order — eyes, head, neck, body.
 */
export type AccessoryLayer = "behind" | "underFace" | "overFace" | "overEyes" | "overAll";

/**
 * The five colours an owl is drawn from, plus six for whatever it is wearing.
 *
 * `accent` is the dark one: eyes and beak. The `trim` three stay inside the
 * palette's own hue, which is what the drawn accessories do — a bow tie is the
 * bird's colour at another lightness, not a contrasting one. `gold` is the
 * exception, and it is what the scarf and the pilot frames were drawn in.
 */
export interface OwlPalette {
  background: string;
  body: string;
  face: string;
  accent: string;
  wing: string;
  /**
   * A rung above `trim`. The four-tone garments need it — a hoodie drawn in a
   * highlight, a body, a shadow and a deep shadow does not fit in three.
   */
  trimLight: string;
  trim: string;
  /** A shade under `trim`, for the shaded half of a two-tone accessory. */
  trimDeep: string;
  /** Near-white: pearls, the crown of a winter hat, petals. */
  trimSoft: string;
  gold: string;
  goldDeep: string;
}

/** A colour role an accessory's paths can ask for. */
export type PaletteSlot = keyof OwlPalette;

export interface OwlOptions {
  /** Rendered width/height. The viewBox is always 1024x1024. */
  size?: number;

  /** A named palette, or partial colour overrides on top of the seeded one. */
  palette?: PaletteName | Partial<OwlPalette>;
  scheme?: PaletteScheme;

  ears?: EarStyle;

  /**
   * What it is wearing, by accessory name, per slot.
   *
   * `null` empties a slot the seed would have filled. Omit a slot to let the
   * seed decide.
   */
  wearing?: Partial<Record<AccessorySlot, string | null>>;

  /** `false` draws the owl on nothing, for a caller that brings its own tile. */
  background?: boolean | string;

  /** 0 is a square, 1 is a circle. The default is square. */
  cornerRadius?: number;

  /** Adds <title> and an accessible name for inline SVG. */
  title?: string;
}

export interface ResolvedOwl {
  seed: string;
  size: number;
  paletteName: PaletteName;
  scheme: PaletteScheme;
  palette: OwlPalette;
  ears: EarStyle;
  /** The accessory chosen in each slot, by name. Absent means nothing. */
  wearing: Partial<Record<AccessorySlot, string>>;
  background: string | null;
  cornerRadius: number;
  title?: string;
}

/** One name per entry in TILE_HUES — see palette.ts. */
export type PaletteName =
  | "violet"
  | "amber"
  | "teal"
  | "pink"
  | "blue"
  | "green"
  | "red"
  | "gold"
  | "indigo"
  | "cyan";

/** How light the owl is against its background. */
export type PaletteScheme = "night" | "day" | "dusk";
