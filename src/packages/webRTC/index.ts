/**
 * Re-exports, not implementations.
 *
 * The connection lives in `@gryt/voice` now. This keeps the `@/webRTC` import
 * path working so the 15 call sites that use it did not have to change.
 *
 * The adapters below are the other direction: what the client has to supply for
 * the engine to work at all.
 */
export type {
  SFUInterface,
  Streams,
  StreamSources,
  VideoStreams,
} from "@gryt/voice";
export { SFUConnectionState, useSFU, useVideoStats, voiceLog } from "@gryt/voice";

// The client's half of the boundary.
export { createRoomCoordinator } from "./src/adapters/roomCoordinator";
export { useVoiceSounds } from "./src/adapters/useVoiceSounds";
export { useVoiceConfigFromSettings } from "./src/adapters/voiceConfig";
export { electronVoiceHost } from "./src/adapters/voiceHost";
export { VoiceProvider } from "./src/adapters/VoiceProvider";

// Stayed behind: UI, and a worker that is browser-specific.
export * from "./src/components/CameraPreviewModal";
export * from "./src/components/controls";
export * from "./src/components/ScreenSharePickerModal";
