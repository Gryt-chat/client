/**
 * The drawing primitives every part is built out of.
 *
 * Owls are symmetric, so parts are authored as a right half in normalised
 * units and mirrored here. That is not just less typing: it is the only way
 * the two halves cannot drift, which they did in the hand-traced first pass —
 * a beak two units off centre reads as a broken face long before anyone can
 * say why.
 */

export const VIEWBOX = 1024;
export const CX = VIEWBOX / 2;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * clamp01(t);
}

/** Two decimals. Enough for a 1024 box, and it keeps the data URI short. */
export function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** A path-data template that formats its interpolated numbers. */
export function d(strings: TemplateStringsArray, ...values: number[]): string {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i += 1) {
    out += fmt(values[i] ?? 0) + (strings[i + 1] ?? "");
  }
  return out.replace(/\s+/g, " ").trim();
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type Point = readonly [number, number];

/**
 * A shape's right half: a start point, then cubic triples (c1, c2, end).
 *
 * x is a fraction of the shape's half-width and y a fraction of its height,
 * both measured from the top of the shape on its axis of symmetry. So (1, 0.5)
 * is the rightmost point at half height, and (0, 1) is the bottom of the axis.
 */
export interface Half {
  readonly points: readonly Point[];
  /**
   * How far past the last point the shape rounds before crossing the axis, in
   * height fractions. 0 closes with a straight line, which is what a shape
   * that already ends on the axis wants.
   */
  readonly cap?: number;
}

/**
 * `half` as closed path data, drawn around an axis at `ax`.
 *
 * The left side is the right side walked backwards with x negated, so the two
 * are the same arithmetic and cannot disagree.
 */
export function symmetric(half: Half, ax: number, top: number, hw: number, h: number): string {
  const { points, cap = 0 } = half;
  const px = (p: Point) => ax + p[0] * hw;
  const py = (p: Point) => top + p[1] * h;

  const first = points[0]!;
  let out = `M${fmt(px(first))} ${fmt(py(first))}`;

  for (let i = 1; i + 2 < points.length; i += 3) {
    const c1 = points[i]!;
    const c2 = points[i + 1]!;
    const end = points[i + 2]!;
    out += `C${fmt(px(c1))} ${fmt(py(c1))} ${fmt(px(c2))} ${fmt(py(c2))} ${fmt(px(end))} ${fmt(py(end))}`;
  }

  const last = points[points.length - 1]!;
  const flip = (p: Point): Point => [-p[0], p[1]];

  // The tip. A cap of 0 degenerates to a straight line across, which is what a
  // shape whose last point already sits on the axis wants.
  const bulge: Point = [last[0], last[1] + cap];
  out += `C${fmt(px(bulge))} ${fmt(py(bulge))} ${fmt(px(flip(bulge)))} ${fmt(py(flip(bulge)))} ${fmt(px(flip(last)))} ${fmt(py(flip(last)))}`;

  for (let i = points.length - 2; i >= 2; i -= 3) {
    const c2 = points[i]!;
    const c1 = points[i - 1]!;
    const end = points[i - 2]!;
    out += `C${fmt(px(flip(c2)))} ${fmt(py(flip(c2)))} ${fmt(px(flip(c1)))} ${fmt(py(flip(c1)))} ${fmt(px(flip(end)))} ${fmt(py(flip(end)))}`;
  }

  return out + "Z";
}

/** `half` as a filled `<path>`. */
export function symmetricPath(
  half: Half,
  ax: number,
  top: number,
  hw: number,
  h: number,
  fill: string,
): string {
  return `<path d="${symmetric(half, ax, top, hw, h)}" fill="${fill}"/>`;
}

/**
 * A closed path through absolute points, in the same start-then-triples form.
 *
 * For the parts that are not symmetric in themselves and are drawn twice, one
 * per side — a wing, an ear, half a pair of glasses.
 */
export function closedPath(points: readonly Point[]): string {
  const first = points[0]!;
  let out = `M${fmt(first[0])} ${fmt(first[1])}`;
  for (let i = 1; i + 2 < points.length; i += 3) {
    const c1 = points[i]!;
    const c2 = points[i + 1]!;
    const end = points[i + 2]!;
    out += `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(end[0])} ${fmt(end[1])}`;
  }
  return out + "Z";
}

/** The same markup again, mirrored across the vertical centre line. */
export function bothSides(render: (side: 1 | -1) => string): string {
  return render(-1) + render(1);
}
