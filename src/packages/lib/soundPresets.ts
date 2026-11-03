import messageBoing from "@/audio/src/assets/sounds/message-boing.mp3";
import messageBright from "@/audio/src/assets/sounds/message-bright.mp3";
import messageChime from "@/audio/src/assets/sounds/message-chime.mp3";
import messageMicrowave from "@/audio/src/assets/sounds/message-microwave.mp3";
import messageScanner from "@/audio/src/assets/sounds/message-scanner.mp3";
import messageSoft from "@/audio/src/assets/sounds/message-soft.mp3";
import ringBright from "@/audio/src/assets/sounds/ring-bright.mp3";
import ringClassic from "@/audio/src/assets/sounds/ring-classic.mp3";
import ringDeskPhone from "@/audio/src/assets/sounds/ring-desk-phone.mp3";
import ringNineties from "@/audio/src/assets/sounds/ring-nineties.mp3";
import ringOldPhone from "@/audio/src/assets/sounds/ring-old-phone.mp3";
import ringWarm from "@/audio/src/assets/sounds/ring-warm.mp3";
import messageClick from "@/audio/src/assets/universfield-computer-mouse-click-02-383961.mp3";

import type { SoundPreset } from "./soundPresetValue";

export { presetIdOf, presetValue, resolveSound, type SoundPreset } from "./soundPresetValue";

/** The first of each list is the default, which is stored as no choice at all. */
export const MESSAGE_SOUNDS: readonly SoundPreset[] = [
  { id: "click", label: "Click", src: messageClick },
  { id: "chime", label: "Chime", src: messageChime },
  { id: "soft", label: "Soft", src: messageSoft },
  { id: "bright", label: "Bright", src: messageBright },
  { id: "boing", label: "Boing", src: messageBoing },
  { id: "scanner", label: "Scanner", src: messageScanner },
  { id: "microwave", label: "Microwave", src: messageMicrowave },
];

export const RINGTONES: readonly SoundPreset[] = [
  { id: "classic", label: "Classic", src: ringClassic },
  { id: "bright", label: "Bright", src: ringBright },
  { id: "warm", label: "Warm", src: ringWarm },
  { id: "nineties", label: "Nineties", src: ringNineties },
  { id: "desk-phone", label: "Desk phone", src: ringDeskPhone },
  { id: "old-phone", label: "Old phone", src: ringOldPhone },
];
