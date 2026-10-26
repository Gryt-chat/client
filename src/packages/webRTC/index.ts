/**
 * What is left of the client's webRTC package. The engine is `@gryt/voice` now;
 * what remains is the client's half of the boundary, plus the UI.
 */
export { setInACall } from "./src/adapters/inACall";
export { createRoomCoordinator } from "./src/adapters/roomCoordinator";
export { type ScreenAudioMute, useScreenAudioMute } from "./src/adapters/useScreenAudioMute";
export { useVoicePresence,type VoicePresence } from "./src/adapters/useVoicePresence";
export { useVoiceSounds } from "./src/adapters/useVoiceSounds";
export { useVoiceConfigFromSettings } from "./src/adapters/voiceConfig";
export { electronVoiceHost } from "./src/adapters/voiceHost";
export { VoiceProvider } from "./src/adapters/VoiceProvider";
export { useAnyCallButtonPress } from "./src/components/callButtonPress";
export * from "./src/components/CameraPreview";
export * from "./src/components/controls";
export * from "./src/components/ScreenSharePickerModal";
