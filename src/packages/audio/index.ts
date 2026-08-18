/**
 * Re-exports, not implementations.
 *
 * Everything here except the hotkey hooks now lives in `@gryt/voice`. This file
 * keeps the `@/audio` import path working so the 22 call sites that use it did
 * not have to change when the engine moved out. The shims go away a few files at
 * a time once the package has proven itself in a real call.
 */
export type {
  CameraFps,
  CaptureQuality as CameraQuality,
  ScreenShareFps,
  CaptureQuality as ScreenShareQuality,
} from "@gryt/voice";
export type { LatencyBreakdown, SharedAudioContextValue } from "@gryt/voice";
export {
  CAMERA_FPS_OPTIONS,
  estimateBitrate,
  EXPERIMENTAL_FPS_OPTIONS,
  getCurrentVolume,
  getIsBrowserSupported,
  getVolumeDb,
  isSpeaking,
  QUALITY_CONSTRAINTS,
  STANDARD_FPS_OPTIONS,
  useCamera,
  useDeviceEnumeration,
  useHandles,
  useMicrophone,
  useNativeScreenCapture,
  useScreenShare,
  useSharedAudioContext,
  useSpeakers,
  useVoiceLatency,
  volumeToLevel,
} from "@gryt/voice";

// Stayed behind: keyboard handling that writes mute and deafen, with no audio
// graph in it. A phone has neither a key to press nor a window to blur.
export { useGlobalHotkeys } from "./src/hooks/useGlobalHotkeys";
