/**
 * The bird itself: silhouette, ear tufts, wings.
 *
 * All three are the painted reference traced once and normalised, not an
 * approximation of it, and none of them has a style to pick. A generated owl
 * that is nearly the drawn owl is worse than either, because the drawn one is
 * what everything else was designed against — the face plate sits where it sits
 * because the head is that shape.
 *
 * The one choice here is whether the ear tufts are there at all.
 */

import { closedPath, symmetricPath, type Half, type Point } from "../geometry";
import type { OwlMetrics } from "../metrics";
import type { EarStyle } from "../types";

/**
 * The head and skirt, as a right half in head-height units.
 *
 * Two cubics up the head because one cannot hug an arc that long: a single
 * segment from crown to shoulder cut the cheek in by forty units, which read
 * as a bird holding its breath.
 *
 * The skirt runs to 2.05 head-heights, well past the bottom of the frame. That
 * is the artboard too — the reference has feet down there that no square crop
 * has ever shown.
 */
const SILHOUETTE: Half = {
  points: [
    [0, 0],
    [0.2942, 0.0074], [0.5235, 0.0494], [0.7352, 0.2231],
    [1.0096, 0.4482], [1.004, 0.7035], [0.9999, 1],
    [1.1858, 1.3539], [1.2238, 1.6749], [1.0547, 2.0473],
  ],
};

export function renderBody(m: OwlMetrics, fill: string): string {
  return symmetricPath(SILHOUETTE, m.cx, m.crown, m.half, m.headHeight, fill);
}

/**
 * Ear tufts, drawn behind the body in the body's own colour.
 *
 * Behind rather than on top, so the seam where a tuft meets the head never
 * shows however the two curves disagree. They are the same fill, so there is
 * nothing to see either way — which is the point.
 *
 * The reference tuft is a thin sickle that flicks up and out from two points on
 * the head arc, and it only clears the silhouette by about a sixth of the body's
 * half-width. It is meant to be small.
 */
export function renderEars(m: OwlMetrics, style: EarStyle, fill: string): string {
  if (style === "none") return "";

  const at = (side: 1 | -1, fx: number, fy: number): Point => [
    m.cx + side * m.half * fx,
    m.crown + m.headHeight * fy,
  ];

  const one = (side: 1 | -1): string =>
    `<path d="${closedPath([
      at(side, 0.7245, 0.2231),
      at(side, 0.691, 0.2023),
      at(side, 0.929, 0.1089),
      at(side, 0.5413, 0.1089),
    ])}" fill="${fill}"/>`;

  return one(-1) + one(1);
}

/**
 * The darker crescent down each side.
 *
 * It shares the body's outer edge exactly — the same three control points — so
 * the two never show a hairline between them at any size. Only the inner edge
 * is the wing's own.
 *
 * Measured from the shoulder rather than the crown, unlike the silhouette. That
 * is worth saying out loud because getting it wrong is silent: the wing still
 * draws, still fills the same corner, and is simply the wrong shape.
 */
export function renderWings(m: OwlMetrics, fill: string): string {
  const at = (side: 1 | -1, fx: number, fy: number): Point => [
    m.cx + side * m.half * fx,
    m.shoulder + m.headHeight * fy,
  ];

  const one = (side: 1 | -1): string =>
    `<path d="${closedPath([
      at(side, 0.9999, 0),
      at(side, 1.1858, 0.3539),
      at(side, 1.2238, 0.6749),
      at(side, 1.0547, 1.0473),
      // Straight across the hem, then the reference's inner edge back up. That
      // edge is the tail half of the drawn one, split where the frame cuts it.
      at(side, 0.6458, 1.0473),
      at(side, 0.6458, 1.0473),
      at(side, 0.6458, 1.0473),
      at(side, 0.5918, 0.7894),
      at(side, 0.6347, 0.4908),
      at(side, 0.7649, 0.3144),
      at(side, 0.845, 0.2059),
      at(side, 0.9324, 0.1124),
      at(side, 0.9999, 0),
    ])}" fill="${fill}"/>`;

  return one(-1) + one(1);
}
