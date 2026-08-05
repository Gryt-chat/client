/**
 * Attempt a perceptually-uniform volume curve.
 *
 * Human hearing is roughly logarithmic, so a linear slider→gain mapping
 * packs most of the perceived change into the bottom 20 %.  A cubic curve
 * (t^3) spreads the perceived loudness change more evenly across the
 * slider's range while keeping the endpoints unchanged:
 *   0 % → 0  (silence)
 *   100 % → 1.0  (unity gain)
 *
 * For sliders whose max exceeds 100 (e.g. 200 % boost) the result scales
 * proportionally (200 % → 8.0 before the /100 normalisation → 2.0 × gain).
 */

/** Convert a linear slider percentage to a perceptual gain multiplier. */
export function sliderToGain(sliderPercent: number, max = 100): number {
  const t = Math.max(0, Math.min(1, sliderPercent / max));
  return t * t * t * (max / 100);
}

/** Inverse of sliderToGain – recover the slider position from a gain value. */
export function gainToSlider(gain: number, max = 100): number {
  const scale = max / 100;
  if (scale === 0) return 0;
  const t = Math.cbrt(gain / scale);
  return Math.max(0, Math.min(max, Math.round(t * max)));
}

/** Highest boost the volume sliders allow: 200 % → 2× amplitude. */
export const MAX_VOLUME_PERCENT = 200;

/**
 * Slider percentage → gain for the microphone and output volume sliders.
 *
 * Deliberately linear: the percentage means what it says, so 100 % is unity
 * and 200 % is twice the amplitude. This replaced a cubic curve (`t³ × 2`)
 * where 100 % was a 2× boost and unity landed at roughly 79 %, which made the
 * numbers meaningless — 50 % was 0.25×, not "half".
 *
 * A cubic can't produce both 100 % → 1× and 200 % → 2× (normalised at 100 it
 * gives 8× at 200), so the perceptual curve was traded for predictability.
 */
export function sliderToOutputGain(sliderPercent: number): number {
  const clamped = Math.max(0, Math.min(MAX_VOLUME_PERCENT, sliderPercent));
  return clamped / 100;
}
