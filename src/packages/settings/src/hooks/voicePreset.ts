/**
 * Voice presets (voice#53): each is a setting of the three processing switches, and eSports
 * mode is its own. Whatever matches none is Custom. Type-only, so a check can run it as is.
 */

export type VoicePreset = "quality" | "low_latency" | "esports" | "custom";

export interface ProcessingSwitches {
  rnnoiseEnabled: boolean;
  autoGainEnabled: boolean;
  compressorEnabled: boolean;
}

export const PRESET_SWITCHES: Record<"quality" | "low_latency", ProcessingSwitches> = {
  quality: { rnnoiseEnabled: true, autoGainEnabled: false, compressorEnabled: true },
  low_latency: { rnnoiseEnabled: false, autoGainEnabled: false, compressorEnabled: false },
};

export function presetOf(settings: ProcessingSwitches & { eSportsModeEnabled: boolean }): VoicePreset {
  if (settings.eSportsModeEnabled) return "esports";
  for (const name of ["quality", "low_latency"] as const) {
    const wanted = PRESET_SWITCHES[name];
    if (
      settings.rnnoiseEnabled === wanted.rnnoiseEnabled &&
      settings.autoGainEnabled === wanted.autoGainEnabled &&
      settings.compressorEnabled === wanted.compressorEnabled
    ) {
      return name;
    }
  }
  return "custom";
}
