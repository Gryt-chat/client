/** Where the voice view's grip can put it. Pure, so `check-voice-grip.ts` can assert it. */

export type VoiceStop = "hidden" | "full" | number;

/** Preset 1: one webcam wide. */
export const VOICE_PRESET_1 = 352;
export const VOICE_MIN_WIDTH = 200;
const MIN_CHAT_WIDTH = 200;
const SNAP_PX = 8;
const GOLDEN = 0.618;

/** The presets for a middle area `room` px wide, or none when the call and the chat can't share it. */
export function voicePresets(room: number): [number, number] | null {
  const preset2 = Math.round(room * GOLDEN);
  if (preset2 > room - MIN_CHAT_WIDTH || preset2 < VOICE_PRESET_1 + SNAP_PX) return null;
  return [VOICE_PRESET_1, preset2];
}

/** A click: hidden → preset 1 → preset 2 → full → hidden. A dragged width goes to the next stop up. */
export function nextVoiceStop(current: VoiceStop, room: number): VoiceStop {
  if (current === "full") return "hidden";
  const presets = voicePresets(room);
  if (!presets) return current === "hidden" ? "full" : "hidden";
  if (current === "hidden") return presets[0];
  return presets.find((p) => p > current + SNAP_PX) ?? "full";
}

/** A drag to `x` px from the left of the middle area. Each stop pulls within 8px. */
export function draggedVoiceStop(x: number, room: number): VoiceStop {
  const presets = voicePresets(room);
  if (!presets) return x < room / 2 ? "hidden" : "full";
  if (x < VOICE_MIN_WIDTH / 2) return "hidden";
  if (x > room - MIN_CHAT_WIDTH) return "full";
  const near = presets.find((p) => Math.abs(x - p) <= SNAP_PX);
  return near ?? Math.max(VOICE_MIN_WIDTH, Math.round(x));
}
