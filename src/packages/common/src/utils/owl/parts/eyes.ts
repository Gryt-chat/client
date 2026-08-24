/**
 * Expressions.
 *
 * The whole set is the painted expression sheet: the drawn squircle, plain
 * dots, tall ovals, arcs for pleased, a heavy lid for unimpressed, a wedge for
 * cross, and one of each for a wink.
 *
 * Every style is drawn around a centre and a radius, so swapping one for
 * another never moves the pair or changes how far apart they are. The gap and
 * the size are the seed's business, not the style's — an expression that also
 * re-spaces the eyes is two changes wearing one name.
 */

import { closedPath, fmt, type Point } from "../geometry";
import type { OwlMetrics } from "../metrics";
import type { EyeStyle, OwlPalette } from "../types";

/**
 * The reference eye: a squircle rotated an eighth of a turn.
 *
 * Four identical segments at ninety degrees to each other, with control points
 * reaching past the radius — that overshoot is what keeps the corners full
 * instead of pinching, and it is why this is not just an ellipse.
 */
const BLOB: readonly Point[] = [
  [-0.36, -1],
  [0.194, -1.2], [0.804, -0.911], [1, -0.354],
  [1.2, 0.194], [0.911, 0.804], [0.354, 1],
  [-0.194, 1.2], [-0.804, 0.911], [-1, 0.354],
  [-1.2, -0.194], [-0.911, -0.804], [-0.36, -1],
];

export function renderEyes(m: OwlMetrics, style: EyeStyle, palette: OwlPalette): string {
  const cy = m.eyeY;
  const fill = palette.accent;
  const r = m.eyeR;

  /** A stroked arch, for the pleased eye and the shut half of a wink. */
  const arch = (cx: number): string =>
    `<path d="M${fmt(cx - r)} ${fmt(cy + r * 0.3)}C${fmt(cx - r * 0.75)} ${fmt(cy - r * 0.85)} ${fmt(cx + r * 0.75)} ${fmt(cy - r * 0.85)} ${fmt(cx + r)} ${fmt(cy + r * 0.3)}" fill="none" stroke="${fill}" stroke-width="${fmt(r * 0.42)}" stroke-linecap="round"/>`;

  const dot = (cx: number): string =>
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${fill}"/>`;

  const one = (side: 1 | -1): string => {
    const cx = m.cx + side * (m.eyeGap / 2);

    switch (style) {
      case "round":
        return dot(cx);

      case "oval":
        return `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(r * 0.84)}" ry="${fmt(r * 1.16)}" fill="${fill}"/>`;

      case "wide":
        return `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(r * 1.22)}" ry="${fmt(r * 0.84)}" fill="${fill}"/>`;

      case "happy":
        return arch(cx);

      // Left eye shut, right eye open. Fixed rather than seeded, because a
      // wink that changes sides between two renders of the same person is a
      // different face, and there is no channel worth spending on it.
      case "wink":
        return side === -1 ? arch(cx) : dot(cx);

      case "sleepy":
        // Flat along the top, full underneath, with the lid drawn as a separate
        // bar running wider than the eye. The bar is what makes it read as half
        // shut; without it the shape is just a semicircle.
        return (
          `<path d="${closedPath([
            [cx - r * 0.98, cy - r * 0.48],
            [cx - r * 1.02, cy + r * 0.9],
            [cx + r * 1.02, cy + r * 0.9],
            [cx + r * 0.98, cy - r * 0.48],
          ])}" fill="${fill}"/>` +
          `<rect x="${fmt(cx - r * 1.2)}" y="${fmt(cy - r * 0.8)}" width="${fmt(r * 2.4)}" height="${fmt(r * 0.17)}" rx="${fmt(r * 0.085)}" fill="${fill}"/>`
        );

      case "angry": {
        // A straight edge falling from the outer corner to a point on the
        // inside, over a full curve underneath. Mirrored, so the pair slopes
        // into the middle the way a scowl does.
        const inner = -side as 1 | -1;
        return `<path d="${closedPath([
          [cx + side * r * 0.95, cy - r * 0.85],
          [cx + inner * r * 0.05, cy - r * 0.42],
          [cx + inner * r * 0.55, cy + r * 0.02],
          [cx + inner * r * 0.95, cy + r * 0.35],
          [cx + inner * r * 0.62, cy + r * 0.9],
          [cx + side * r * 0.05, cy + r * 1.05],
          [cx + side * r * 0.62, cy + r * 0.92],
          [cx + side * r * 1.06, cy + r * 0.74],
          [cx + side * r * 1.18, cy + r * 0.1],
          [cx + side * r * 0.95, cy - r * 0.85],
        ])}" fill="${fill}"/>`;
      }

      case "bright":
        // A catchlight, in the face's colour so it reads as a hole in the eye
        // rather than as a white dot stuck on top of one.
        return (
          dot(cx) +
          `<circle cx="${fmt(cx + side * r * 0.36)}" cy="${fmt(cy - r * 0.36)}" r="${fmt(r * 0.3)}" fill="${palette.face}"/>`
        );

      case "ring":
        return (
          `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r * 1.18)}" fill="${fill}"/>` +
          `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r * 0.86)}" fill="${palette.face}"/>` +
          `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r * 0.46)}" fill="${fill}"/>`
        );

      case "blob":
      default:
        return `<path d="${closedPath(
          BLOB.map(([x, y]): Point => [cx + side * x * r, cy + y * r]),
        )}" fill="${fill}"/>`;
    }
  };

  return one(-1) + one(1);
}
