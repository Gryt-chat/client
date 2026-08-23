/**
 * What is left of the client's webRTC package.
 *
 * The engine is `@gryt/voice` now and call sites import it from there directly.
 * What remains is the client's half of the boundary — the things the engine is
 * given rather than the things it does — plus the UI.
 */
export { createRoomCoordinator } from "./src/adapters/roomCoordinator";
export { type ScreenAudioMute, useScreenAudioMute } from "./src/adapters/useScreenAudioMute";
export { useVoiceSounds } from "./src/adapters/useVoiceSounds";
export { useVoiceConfigFromSettings } from "./src/adapters/voiceConfig";
export { electronVoiceHost } from "./src/adapters/voiceHost";
export { VoiceProvider } from "./src/adapters/VoiceProvider";
export * from "./src/components/CameraPreviewModal";
export * from "./src/components/controls";
export * from "./src/components/ScreenSharePickerModal";
