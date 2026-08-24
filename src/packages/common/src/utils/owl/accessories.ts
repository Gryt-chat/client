/**
 * What an owl can wear.
 *
 * Empty on purpose. The drawings go in below, and this file is the whole of
 * what adding one involves.
 *
 * ## Adding one
 *
 * An accessory is exported from the design file on the **same 1024 x 1024 frame
 * as the owl**, positioned exactly where it should sit, with the background,
 * body, face plate, eyes and beak layers removed. Its path data then goes in
 * here verbatim — no scaling, no anchor point, no arithmetic. That is the entire
 * reason for the 1024 frame: an earlier pass had each drawing in its own
 * coordinate space and every one of them needed two numbers guessed by eye,
 * which is where the crooked ones came from.
 *
 * Each path names a colour role rather than carrying a hex, so a teal owl and a
 * pink owl wear the same hat in their own colours. The roles are the keys of
 * `OwlPalette` — `trim`, `trimDeep`, `trimSoft`, `gold`, `goldDeep`, `accent`,
 * `wing`, `face`. The drawn accessories mostly used the bird's own hue at a
 * different lightness, which is what `trim` and its two neighbours are for;
 * `gold` is the odd one out and it is what the scarf and the pilot frames were
 * painted in.
 *
 * ## Slots and layers
 *
 * `slot` is where it is worn, and one accessory is drawn per slot. Four slots
 * means a hat and glasses and a scarf are three independent rolls that can all
 * come up at once — and that two hats never can.
 *
 * `layer` is where it lands in the stack, and it is per accessory rather than
 * per slot because two things worn in the same place do not always sit at the
 * same depth. A pair of glasses whose lenses are painted rather than punched
 * has to go under the eyes, so the owl's own eyes land on top of it and the
 * expression still shows through the glass. A frame with real holes in it wants
 * to be over them. Both are `slot: "eyes"`.
 *
 * `excludes` is for the pairs that are each fine alone and wrong together — a
 * scarf under a buttoned jacket, a hat under a hood.
 */

import { GENERATED_ACCESSORIES } from "./accessories.generated";
import type {
  AccessoryLayer,
  AccessorySlot,
  OwlPalette,
  OwlPart,
  PaletteSlot,
} from "./types";

export interface AccessoryPath {
  /** Path data on the owl's own 1024 x 1024 frame, verbatim. */
  d: string;
  /** Which palette colour fills this path. Absent on a stroke-only line. */
  fill?: PaletteSlot;
  /**
   * A line rather than a shape.
   *
   * Not every drawn thing is a filled outline — the winter jacket's sleeve
   * seams are drawn with the pen tool and come out as a stroke with no fill at
   * all. Treated as a fill they turn into solid blobs across the sleeve, so the
   * stroke has to survive the trip.
   */
  stroke?: PaletteSlot;
  /** In artwork units, on the 1024 frame. */
  strokeWidth?: number;
  linecap?: "butt" | "round" | "square";
  linejoin?: "miter" | "round" | "bevel";
  /** Set for a path that carries its own holes. */
  evenodd?: boolean;
}

export interface Accessory {
  /** Stable. It is what `wearing` names and what a picker stores. */
  name: string;
  slot: AccessorySlot;
  layer: AccessoryLayer;
  /**
   * Slots this cannot be worn with. Checked both ways, so declaring it on one
   * of a conflicting pair is enough.
   */
  excludes?: readonly AccessorySlot[];
  /**
   * How often it comes up, against the other accessories in its slot and
   * against the slot's own chance of being empty. See EMPTY_WEIGHT.
   */
  weight: number;
  /**
   * Base parts this repaints, as role -> role.
   *
   * A coat covers the owl's arms, so the drawing paints the wings in the
   * background's colour and they vanish. That is a change to the bird rather
   * than a shape drawn on top of it, and it has to travel with the coat: the
   * extractor spots the recoloured path and records `{ wing: "background" }`
   * here rather than quietly subtracting it away and losing the intent.
   *
   * Repaints a role, not a path, so both wings go together and it still works
   * on all thirty palettes.
   */
  recolour?: Readonly<Partial<Record<PaletteSlot, PaletteSlot>>>;
  /**
   * Parts of the bird this replaces, which are then not drawn at all.
   *
   * An expression brings its own eyes. In the drawing that reads as the eyes
   * being painted the same colour as the face plate, but painting them out is
   * not the same as leaving them out: the eyes and the beak are both drawn in
   * `accent`, so a repaint would take the beak with them, and a plate-coloured
   * disc is wrong anywhere the plate is not what is behind it.
   */
  hides?: readonly OwlPart[];
  /** Drawn in order, back to front. Keep the design file's own order. */
  paths: readonly AccessoryPath[];
}

/**
 * How much weight "nothing" carries in each slot.
 *
 * High, and deliberately. A uniform draw over a slot's contents plus nothing
 * puts a hat on most of a member list, and at that rate the hat stops being a
 * thing about that person and becomes noise. These numbers are weighed against
 * the sum of the accessories in the slot, so adding a fifth hat makes hats a
 * little more common rather than making every owl wear one.
 */
export const EMPTY_WEIGHT: Record<AccessorySlot, number> = {
  // Empty here is not a face with no eyes — it is the eyes the bird is drawn
  // with, which is the one every other expression is a departure from.
  expression: 46,
  eyewear: 90,
  head: 60,
  neck: 48,
  body: 70,
};

/**
 * Everything an owl can wear.
 *
 * Generated from `artwork/` by `scripts/owl-accessory.mjs --all`, which takes a
 * drawing of the bird wearing something and subtracts the bird back out. The
 * drawings are the source; this list is derived from them, and editing it by
 * hand means the next run of that script throws the edit away.
 */
export const ACCESSORIES: readonly Accessory[] = GENERATED_ACCESSORIES;

export function accessoriesIn(slot: AccessorySlot): Accessory[] {
  return ACCESSORIES.filter((a) => a.slot === slot);
}

export function accessoryByName(name: string): Accessory | undefined {
  return ACCESSORIES.find((a) => a.name === name);
}

/**
 * The palette after everything worn has had its say.
 *
 * Applied in slot order so two garments asking for the same repaint settle it
 * the same way on every client. Reads every role off the original palette, not
 * off the half-updated copy, so `{ wing: "background", background: "wing" }`
 * swaps them rather than collapsing both into one.
 */
export function repaint(palette: OwlPalette, worn: readonly Accessory[]): OwlPalette {
  let out = palette;
  for (const accessory of worn) {
    if (!accessory.recolour) continue;
    const next = { ...out };
    for (const [part, source] of Object.entries(accessory.recolour)) {
      next[part as PaletteSlot] = out[source as PaletteSlot];
    }
    out = next;
  }
  return out;
}
