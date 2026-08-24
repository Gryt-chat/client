/**
 * Where everything is.
 *
 * Every number here came off the 1024 artboard, and none of them varies. That
 * is a decision, not a shortcut: the accessories are drawn on the same 1024
 * frame and dropped in at their own coordinates, so anything that moved an eye
 * would move it out from behind its glasses. Fixing the bird is what makes
 * importing a drawing a paste rather than a fitting exercise.
 *
 * What the seed still decides is the colour, the expression, the ear tufts and
 * what the owl is wearing.
 *
 * Parts take these rather than reading the constants directly, so a part is
 * still a function of where things are rather than of a global. Useful when the
 * next question is "what would it take to draw this at another size".
 */

export interface OwlMetrics {
  cx: number;
  /** Top of the head. */
  crown: number;
  /** Half the body's width where it is widest, at the shoulder. */
  half: number;
  /** The y the body stops growing outward and starts flaring into the skirt. */
  shoulder: number;
  /** shoulder - crown. Every head-relative fraction is measured in these. */
  headHeight: number;

  faceTop: number;
  faceHalf: number;
  faceHeight: number;

  eyeY: number;
  /** Centre to centre. */
  eyeGap: number;
  eyeR: number;

  beakTop: number;
  beakHalf: number;
  beakHeight: number;
}

/** The drawn owl, measured. */
export const OWL: OwlMetrics = {
  cx: 512,
  crown: 191,
  half: 395,
  shoulder: 677,
  headHeight: 486,

  faceTop: 353,
  faceHalf: 289.5,
  faceHeight: 419,

  eyeY: 495.7,
  eyeGap: 286.3,
  eyeR: 50.5,

  beakTop: 573.19,
  beakHalf: 60,
  beakHeight: 104,
};
