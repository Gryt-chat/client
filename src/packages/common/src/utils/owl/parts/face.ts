/**
 * The pale plate the eyes and beak sit on, and the beak under them.
 *
 * Both are the reference traced exactly, and neither has a style to pick. The
 * plate's two brow lobes meeting in a notch are the thing that makes the
 * silhouette read as an owl rather than as a bird, and a set of avatars that
 * varies it is a set of avatars of different animals.
 */

import { symmetricPath, type Half } from "../geometry";
import type { OwlMetrics } from "../metrics";

/**
 * Measured off the artboard and divided through by its half-width and height.
 *
 * Seven segments, which is the drawing's own count rather than a fit down to
 * three. The lobes are the whole character of it and a three-segment fit
 * rounded the notch off into a dent.
 */
const PLATE: Half = {
  points: [
    [0, 0.0743],
    [0.0114, 0.0743], [0.2652, 0], [0.4573, 0],
    [0.7469, 0], [0.9835, 0.1137], [0.9991, 0.3106],
    [0.9991, 0.3517], [0.9968, 0.3714], [0.9948, 0.3908],
    [0.9841, 0.4538], [0.9608, 0.5157], [0.9254, 0.5745],
    [0.8752, 0.6582], [0.8015, 0.7341], [0.7086, 0.7981],
    [0.6158, 0.8621], [0.5056, 0.9129], [0.3843, 0.9475],
    [0.263, 0.9822], [0.1319, 1], [0, 1],
  ],
};

/**
 * A horizontal cusp at the top, widest a third of the way down, tapering to a
 * rounded tip.
 *
 * The cusp is why the first control point sits a full width out at zero height:
 * the curve leaves the axis travelling sideways, which is what gives the beak
 * its flat shoulder instead of a point.
 */
const BEAK: Half = {
  points: [[0, 0], [1.004, 0.0034], [0.4035, 0.6483], [0.0621, 0.9965]],
  cap: 0.0269,
};

export function renderFace(m: OwlMetrics, fill: string): string {
  return symmetricPath(PLATE, m.cx, m.faceTop, m.faceHalf, m.faceHeight, fill);
}

export function renderBeak(m: OwlMetrics, fill: string): string {
  return symmetricPath(BEAK, m.cx, m.beakTop, m.beakHalf, m.beakHeight, fill);
}
