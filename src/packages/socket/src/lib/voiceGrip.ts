/** Where the voice view's grip can put it. Pure, so `check-voice-grip.ts` can assert it. */

// Preset 2 is kept by name: the middle changes size when the member list folds, and the preset moves with it.
export type VoiceStop = "hidden" | "full" | "preset2" | number;

/** Preset 1: one webcam wide. */
export const VOICE_PRESET_1 = 352;
export const VOICE_MIN_WIDTH = 200;
const MIN_CHAT_WIDTH = 200;
/** The chat a preset leaves must still read (the Narrow board's 820 step): under this the call is full or hidden. */
const MIN_CHAT_BESIDE_PRESET = 360;
const SNAP_PX = 8;
const GOLDEN = 0.618;

/** The presets for a middle area `room` px wide, or none when the call and the chat can't share it. */
export function voicePresets(room: number): [number, number] | null {
  const preset2 = Math.round(room * GOLDEN);
  if (room - VOICE_PRESET_1 - 16 < MIN_CHAT_BESIDE_PRESET) return null;
  if (preset2 > room - MIN_CHAT_WIDTH || preset2 < VOICE_PRESET_1 + SNAP_PX) return null;
  return [VOICE_PRESET_1, preset2];
}

/** The visible width a stop draws at; `null` for hidden and full. */
export function voiceStopWidth(stop: VoiceStop, room: number): number | null {
  if (stop === "hidden" || stop === "full") return null;
  if (stop === "preset2") return voicePresets(room)?.[1] ?? VOICE_PRESET_1;
  return stop;
}

/** A click: hidden → preset 1 → preset 2 → full → hidden. A dragged width goes to the next stop up. */
export function nextVoiceStop(current: VoiceStop, room: number): VoiceStop {
  if (current === "full" || current === "preset2") return current === "full" ? "hidden" : "full";
  const presets = voicePresets(room);
  if (!presets) return current === "hidden" ? "full" : "hidden";
  if (current === "hidden") return presets[0];
  if (presets[0] > current + SNAP_PX) return presets[0];
  return presets[1] > current + SNAP_PX ? "preset2" : "full";
}

/** A drag to `x` px from the left of the middle area. Each stop pulls within 8px. */
export function draggedVoiceStop(x: number, room: number): VoiceStop {
  const presets = voicePresets(room);
  if (!presets) return x < room / 2 ? "hidden" : "full";
  if (x < VOICE_MIN_WIDTH / 2) return "hidden";
  if (x > room - MIN_CHAT_WIDTH) return "full";
  if (Math.abs(x - presets[0]) <= SNAP_PX) return presets[0];
  if (Math.abs(x - presets[1]) <= SNAP_PX) return "preset2";
  return Math.max(VOICE_MIN_WIDTH, Math.round(x));
}
