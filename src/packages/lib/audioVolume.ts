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

/**
 * Convenience wrapper for the common Web Audio pattern where
 * 50 on the slider means unity gain (1.0×).
 *
 * Equivalent to `sliderToGain(value, 100) * 2` — the extra `* 2` comes
 * from the legacy `/50` convention (100/50 = 2).
 */
export function sliderToOutputGain(sliderPercent: number): number {
  const t = Math.max(0, Math.min(1, sliderPercent / 100));
  return t * t * t * 2;
}
