/**
 * A perceptually-uniform volume curve. Hearing is roughly logarithmic, so a cubic
 * spreads the change across the slider while keeping 0 → 0 and 100% → 1.0.
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
 * Slider percentage → gain for the microphone and output sliders. Deliberately
 * linear, so 100% is unity and 200% is twice the amplitude.
 */
export function sliderToOutputGain(sliderPercent: number): number {
  const clamped = Math.max(0, Math.min(MAX_VOLUME_PERCENT, sliderPercent));
  return clamped / 100;
}
