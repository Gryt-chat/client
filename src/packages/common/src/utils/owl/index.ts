/**
 * Gryt's owls: a deterministic avatar generator.
 *
 * The same seed always draws the same owl, on every client, forever. That is
 * the only hard requirement — a person is recognised by their avatar, so an owl
 * that shifts when this library is upgraded has failed at the one job it has.
 * Two consequences that look like fussiness and are not:
 *
 *   - Every random draw is keyed on a channel name (see rng.ts), so adding a
 *     part does not reshuffle the parts that were already there.
 *   - Nothing depends on the platform. No Math.random, no Date, no locale, no
 *     Intl. The web client and the mobile app run this same file and have to
 *     agree byte for byte, and there is a test in both trees that checks they
 *     do.
 *
 * This is not a DiceBear style and does not plug into one. It replaced DiceBear
 * outright for user avatars, because what was wanted was one drawn character
 * with variations rather than a generic face generator — DiceBear's model is a
 * style definition of interchangeable sprite layers, and the owl is a single
 * drawing. Server icons are still DiceBear Planets; a server is not a person
 * and should not be drawn as one.
 *
 * The bird itself never varies, in shape or in size. What the seed picks is the
 * palette, the expression, whether there are ear tufts, and what it is wearing.
 * See metrics.ts for why the geometry is nailed down and accessories.ts for
 * what wearing something involves.
 */

import { escapeXml, fmt, VIEWBOX } from "./geometry";
import { OWL } from "./metrics";
import { owlPalette, PALETTE_NAMES, PALETTE_SCHEMES } from "./palette";
import { renderBody, renderEars, renderWings } from "./parts/body";
import { renderEyes } from "./parts/eyes";
import { renderBeak, renderFace } from "./parts/face";
import { hash32, pick, pickWeighted } from "./rng";
import {
  accessoriesIn,
  accessoryByName,
  EMPTY_WEIGHT,
  repaint,
  type Accessory,
} from "./accessories";
import type {
  AccessoryLayer,
  AccessorySlot,
  EarStyle,
  OwlOptions,
  OwlPalette,
  OwlPart,
  ResolvedOwl,
  Seed,
} from "./types";

export * from "./types";
export { owlPalette, allOwlPalettes, hsl, PALETTE_NAMES, PALETTE_SCHEMES, TILE_HUES } from "./palette";
export { OWL, type OwlMetrics } from "./metrics";
export {
  ACCESSORIES,
  EMPTY_WEIGHT,
  accessoriesIn,
  accessoryByName,
  repaint,
  type Accessory,
  type AccessoryPath,
} from "./accessories";

export const EAR_STYLES: EarStyle[] = ["none", "tufts"];

/**
 * The order slots are drawn in, and the order they are chosen in.
 *
 * Fixed, and it has to stay fixed: change it and everyone who owns two things
 * that exclude each other swaps one for the other.
 */
export const ACCESSORY_SLOTS: AccessorySlot[] = [
  "expression", "eyewear", "head", "neck", "body",
];

/** `tufts` beats `none` because the drawn owl has them. */
const EAR_WEIGHTS: readonly (readonly [EarStyle, number])[] = [
  ["tufts", 68], ["none", 32],
];

/**
 * What this seed wears.
 *
 * Slots are drawn in a fixed order and a slot whose accessory conflicts with
 * something already chosen comes up empty. Fixed order rather than by weight,
 * because it has to be the same order on every client and forever: change it
 * and everyone who owns a scarf and a jacket swaps one for the other.
 */
function chooseAccessories(
  seed: string,
  asked: Partial<Record<AccessorySlot, string | null>> = {},
): Partial<Record<AccessorySlot, string>> {
  const worn: Partial<Record<AccessorySlot, string>> = {};
  const taken: AccessorySlot[] = [];

  for (const slot of ACCESSORY_SLOTS) {
    const override = asked[slot];
    if (override === null) continue;
    if (override !== undefined) {
      if (accessoryByName(override)) {
        worn[slot] = override;
        taken.push(slot);
      }
      continue;
    }

    const available = accessoriesIn(slot).filter(
      (a) =>
        !taken.some((t) => a.excludes?.includes(t)) &&
        !taken.some((t) => accessoryByName(worn[t]!)?.excludes?.includes(slot)),
    );
    if (available.length === 0) continue;

    const entries: [Accessory | null, number][] = [[null, EMPTY_WEIGHT[slot]]];
    for (const a of available) entries.push([a, a.weight]);

    const chosen = pickWeighted(seed, `wear:${slot}`, entries);
    if (chosen) {
      worn[slot] = chosen.name;
      taken.push(slot);
    }
  }

  return worn;
}

/** Every choice this seed makes, with anything the caller passed in taking over. */
export function resolveOwl(seed: Seed, options: OwlOptions = {}): ResolvedOwl {
  const s = String(seed);

  const paletteName =
    typeof options.palette === "string" ? options.palette : pick(s, "palette", PALETTE_NAMES);
  const scheme = options.scheme ?? pick(s, "scheme", PALETTE_SCHEMES);

  const base = owlPalette(paletteName, scheme);
  const palette: OwlPalette =
    options.palette && typeof options.palette === "object"
      ? { ...base, ...options.palette }
      : base;

  const background =
    options.background === false ? null
    : typeof options.background === "string" ? options.background
    : palette.background;

  const resolved: ResolvedOwl = {
    seed: s,
    size: Math.max(1, Math.round(options.size ?? 256)),
    paletteName,
    scheme,
    palette,
    ears: options.ears ?? pickWeighted(s, "ears", EAR_WEIGHTS),
    wearing: chooseAccessories(s, options.wearing),
    background,
    cornerRadius: Math.min(1, Math.max(0, options.cornerRadius ?? 0)),
  };

  if (options.title !== undefined) resolved.title = options.title;
  return resolved;
}

/** Everything worn, in slot order. */
function wornBy(c: ResolvedOwl): Accessory[] {
  const out: Accessory[] = [];
  for (const slot of ACCESSORY_SLOTS) {
    const name = c.wearing[slot];
    const worn = name ? accessoryByName(name) : undefined;
    if (worn) out.push(worn);
  }
  return out;
}

function renderAccessories(
  worn: readonly Accessory[],
  palette: OwlPalette,
  layer: AccessoryLayer,
): string {
  let out = "";
  for (const accessory of worn) {
    if (accessory.layer !== layer) continue;
    for (const p of accessory.paths) {
      // `fill="none"` is spelled out rather than left off. An SVG dropped into
      // an <img> has no page around it to inherit from, and the default is
      // black — so an unfilled line comes out as a solid blob.
      out +=
        `<path d="${p.d}"` +
        (p.evenodd ? ' fill-rule="evenodd" clip-rule="evenodd"' : "") +
        ` fill="${p.fill ? palette[p.fill] : "none"}"` +
        (p.stroke
          ? ` stroke="${palette[p.stroke]}" stroke-width="${p.strokeWidth ?? 1}"` +
            (p.linecap ? ` stroke-linecap="${p.linecap}"` : "") +
            (p.linejoin ? ` stroke-linejoin="${p.linejoin}"` : "")
          : "") +
        "/>";
    }
  }
  return out;
}

/**
 * `seed`'s owl, as SVG markup.
 *
 * Back to front: field, anything worn behind the bird, ear tufts, body, wings,
 * chest-level accessories, face plate, glasses that want to be under the eyes,
 * eyes, beak, glasses that want to be over them, then hats. The tufts go behind
 * the body rather than on it so the seam where they meet never shows, and a hat
 * goes last so it covers those tufts rather than growing out of them.
 */
export function owlAvatarSvg(seed: Seed, options: OwlOptions = {}): string {
  const c = resolveOwl(seed, options);
  const m = OWL;
  const worn = wornBy(c);

  // A coat repaints the arms out. That has to happen before anything is drawn,
  // and it applies to the bird's own parts as well as to the coat.
  const p = repaint(c.palette, worn);

  // A drawing that brings its own version of a part says so, and the bird's own
  // is then not drawn at all. Painting it out instead would be wrong twice: the
  // eyes and the beak share a colour, and a plate-coloured shape is only
  // invisible where the plate is what happens to be behind it.
  const hidden = new Set<OwlPart>();
  for (const accessory of worn) for (const part of accessory.hides ?? []) hidden.add(part);
  const draw = (part: OwlPart, markup: string) => (hidden.has(part) ? "" : markup);

  const parts =
    renderAccessories(worn, p, "behind") +
    draw("earTufts", renderEars(m, c.ears, p.body)) +
    draw("body", renderBody(m, p.body)) +
    draw("wings", renderWings(m, p.wing)) +
    renderAccessories(worn, p, "underFace") +
    draw("face", renderFace(m, p.face)) +
    renderAccessories(worn, p, "overFace") +
    draw("eyes", renderEyes(m, p)) +
    draw("beak", renderBeak(m, p.accent)) +
    renderAccessories(worn, p, "overEyes") +
    renderAccessories(worn, p, "overAll");

  const title = c.title ? `<title>${escapeXml(c.title)}</title>` : "";
  const label = c.title
    ? ` role="img" aria-label="${escapeXml(c.title)}"`
    : ` role="img" aria-hidden="true"`;

  // The clip only earns its keep when there is a corner radius to clip to, and
  // it costs an id that has to stay unique on a page with fifty avatars on it.
  // Without one, the parts that run past the frame are left to the viewBox.
  const radius = c.cornerRadius * (VIEWBOX / 2);
  const field = c.background
    ? `<rect width="${VIEWBOX}" height="${VIEWBOX}"${radius > 0 ? ` rx="${fmt(radius)}"` : ""} fill="${c.background}"/>`
    : "";

  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.size}" height="${c.size}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" fill="none"${label}>${title}`;

  if (radius > 0) {
    const id = `owl${hash32(c.seed).toString(36)}`;
    return (
      `${open}<defs><clipPath id="${id}"><rect width="${VIEWBOX}" height="${VIEWBOX}" rx="${fmt(radius)}"/></clipPath></defs>` +
      `<g clip-path="url(#${id})">${field}${parts}</g></svg>`
    );
  }

  return `${open}${field}${parts}</svg>`;
}

/**
 * The bird's own paths, each tagged with the part that drew it.
 *
 * For tooling rather than for drawing. The accessory extractor has to know that
 * a repainted path is an eye and not the beak, and it cannot tell from the
 * colour — both are `accent`. Rendering each part separately is the only answer
 * that stays true when the parts are reordered or repainted.
 */
export function owlPartPaths(options: OwlOptions = {}): { part: OwlPart; d: string }[] {
  const c = resolveOwl("parts", options);
  const m = OWL;
  const p = c.palette;

  const shapes = (part: OwlPart, markup: string) =>
    [...markup.matchAll(/\bd="([^"]*)"/g)].map((match) => ({ part, d: match[1]! }));

  return [
    ...shapes("earTufts", renderEars(m, c.ears, p.body)),
    ...shapes("body", renderBody(m, p.body)),
    ...shapes("wings", renderWings(m, p.wing)),
    ...shapes("face", renderFace(m, p.face)),
    ...shapes("eyes", renderEyes(m, p)),
    ...shapes("beak", renderBeak(m, p.accent)),
  ];
}

/** The same owl as a data URI, for an `<img src>`. */
export function owlAvatarDataUri(seed: Seed, options: OwlOptions = {}): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(owlAvatarSvg(seed, options))}`;
}

/**
 * The colour this owl's field is painted in, as `#rrggbb`.
 *
 * Voice tiles are tinted from it. The background rather than the body, because
 * the background is what the eye reads as "that person's colour" at avatar size
 * — and because it is built from a TILE_HUES entry, so the tint's snap back to
 * the palette is exact rather than nearest-ish.
 */
export function owlAvatarColour(seed: Seed, options: OwlOptions = {}): string {
  return resolveOwl(seed, options).palette.background;
}
