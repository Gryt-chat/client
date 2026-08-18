import type {
  CameraFps,
  CaptureQuality,
  ScreenShareFps,
  VoiceConfig,
} from "@gryt/voice";
import { useMemo } from "react";

import { useSettings } from "@/settings";

/**
 * The client's settings, in the shape the engine asks for.
 *
 * The engine used to read `useSettings` in ten places. It now takes a
 * `VoiceConfig`, and this is the one place that knows both shapes. Renaming a
 * setting is a change here rather than a change inside the SDK.
 *
 * `stunHosts` is not here: it comes from whichever server is on screen and is
 * supplied alongside the connection target, which the engine is also not allowed
 * to look up for itself.
 *
 * The quality and fps casts are the one loose seam. The settings store types
 * those fields as `string` and `number` while the engine wants the unions, so
 * this asserts rather than validates. The old code did the same thing one level
 * down — `screenShareQuality as ScreenShareQuality` was already in
 * `useScreenShare` — so nothing has become less safe, but the settings store is
 * where it should be fixed. Tracked on GRYT-341.
 */
export function useVoiceConfigFromSettings(stunHosts: string[]): VoiceConfig {
  const s = useSettings();

  return useMemo(
    () => ({
      audio: {
        deviceId: s.micID,
        muted: s.isMuted,
        serverMuted: s.isServerMuted,
        deafened: s.isDeafened,
        serverDeafened: s.isServerDeafened,
        inputMode: s.inputMode,
        volume: s.micVolume,
        outputVolume: s.outputVolume,
        loopback: s.loopbackEnabled,
        noiseSuppression: s.rnnoiseEnabled,
        noiseGate: s.noiseGate,
        noiseGateRelease: s.noiseGateRelease,
        autoGain: { enabled: s.autoGainEnabled, targetDb: s.autoGainTargetDb },
        compressorEnabled: s.compressorEnabled,
        compressorAmount: s.compressorAmount,
      },
      camera: {
        deviceId: s.cameraID,
        quality: s.cameraQuality as CaptureQuality,
        fps: s.cameraFps as CameraFps,
        mirrored: s.cameraFlipped,
      },
      screen: {
        quality: s.screenShareQuality as CaptureQuality,
        fps: s.screenShareFps as ScreenShareFps,
        codec: s.screenShareCodec,
        gamingMode: s.screenShareGamingMode,
      },
      connection: {
        stunHosts,
        eSportsMode: s.eSportsModeEnabled,
      },
    }),
    [
      s.micID, s.isMuted, s.isServerMuted, s.isDeafened, s.isServerDeafened,
      s.inputMode, s.micVolume, s.outputVolume, s.loopbackEnabled, s.rnnoiseEnabled,
      s.noiseGate, s.noiseGateRelease, s.autoGainEnabled, s.autoGainTargetDb,
      s.compressorEnabled, s.compressorAmount, s.cameraID, s.cameraQuality,
      s.cameraFps, s.cameraFlipped, s.screenShareQuality, s.screenShareFps,
      s.screenShareCodec, s.screenShareGamingMode, s.eSportsModeEnabled,
      stunHosts,
    ],
  );
}
