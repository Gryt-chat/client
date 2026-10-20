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

/** Low latency also takes the direct path: no gate in the way, and volume left as the microphone gives it. */
export const LOW_LATENCY_GATE = 0;
export const LOW_LATENCY_VOLUME = 100;

export interface PresetInputs extends ProcessingSwitches {
  eSportsModeEnabled: boolean;
  noiseGate: number;
  micVolume: number;
  inputMode: "voice_activity" | "push_to_talk";
}

const sameSwitches = (s: ProcessingSwitches, wanted: ProcessingSwitches) =>
  s.rnnoiseEnabled === wanted.rnnoiseEnabled &&
  s.autoGainEnabled === wanted.autoGainEnabled &&
  s.compressorEnabled === wanted.compressorEnabled;

export function presetOf(settings: PresetInputs): VoicePreset {
  if (settings.eSportsModeEnabled) return "esports";
  if (sameSwitches(settings, PRESET_SWITCHES.quality)) return "quality";
  const gateOff = settings.inputMode === "push_to_talk" || settings.noiseGate === LOW_LATENCY_GATE;
  if (sameSwitches(settings, PRESET_SWITCHES.low_latency) && gateOff && settings.micVolume === LOW_LATENCY_VOLUME) {
    return "low_latency";
  }
  return "custom";
}
