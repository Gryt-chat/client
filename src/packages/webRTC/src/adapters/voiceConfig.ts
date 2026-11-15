import {
  type CameraFps,
  type CaptureQuality,
  opusWasmUrl,
  type ScreenShareFps,
  setVoicePlatform,
  type VoiceConfig,
  webPlatform,
} from "@gryt/voice";
import { useMemo, useSyncExternalStore } from "react";

import { IS_BETA_BUILD } from "@/common";
import { useSettings } from "@/settings";

import { isMacAppStoreBuild, isMacDesktop } from "../../../../lib/electron";
import { startDesktopNativeAudio } from "./desktopNativeVoice";
import { firstShareKey, shareMeta, useShareWindowsVersion } from "./shareWindows";

/** The own voice transport (GRYT-1818): on in beta builds on the way to dropping WebRTC audio (GRYT-1831), off in stable.
    `localStorage["gryt.ownAudioTransport"]` = "1" or "0" overrides either way. */
function ownTransportOn(): boolean {
  try {
    const set = localStorage.getItem("gryt.ownAudioTransport");
    return set === null ? IS_BETA_BUILD : set === "1";
  } catch {
    return IS_BETA_BUILD;
  }
}
/** The phone's native engine on the Mac desktop, through gryt-voice (GRYT-1837): beta only, and not the store
    build, which can't ship it. `localStorage["gryt.nativeVoice"]` = "1" or "0" overrides. */
function nativeVoiceOn(): boolean {
  if (!isMacDesktop() || isMacAppStoreBuild()) return false;
  try {
    const set = localStorage.getItem("gryt.nativeVoice");
    return set === null ? IS_BETA_BUILD : set === "1";
  } catch {
    return IS_BETA_BUILD;
  }
}
let newVoice = ownTransportOn();
let nativeAudio = nativeVoiceOn();
const listeners = new Set<() => void>();

function applyPlatform(): void {
  setVoicePlatform(nativeAudio ? { ...webPlatform, startNativeAudio: startDesktopNativeAudio } : webPlatform);
}
applyPlatform();

/** Live: the engine reads it at join, and useVoiceLifecycle rejoins a call in progress when it flips. */
export function useNewVoice(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => newVoice,
  );
}

export function setNewVoice(on: boolean): void {
  try {
    localStorage.setItem("gryt.ownAudioTransport", on ? "1" : "0");
    localStorage.setItem("gryt.nativeVoice", on ? "1" : "0");
  } catch {
    // Storage blocked: the switch still holds until Gryt closes.
  }
  newVoice = on;
  nativeAudio = on && nativeVoiceOn();
  applyPlatform();
  for (const listener of listeners) listener();
}
const loadOpusWasm = (): Promise<ArrayBuffer> => fetch(opusWasmUrl()).then((r) => r.arrayBuffer());

/**
 * The client's settings, in the shape the engine asks for — **the one place that
 * knows both**. The quality and fps casts assert rather than validate (GRYT-341).
 */
export function useVoiceConfigFromSettings(stunHosts: string[]): VoiceConfig {
  const s = useSettings();
  const on = useNewVoice();
  useShareWindowsVersion();
  const first = shareMeta(firstShareKey());
  const screenQuality = first?.quality ?? s.screenShareQuality;
  const screenFps = first?.fps ?? s.screenShareFps;

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
        bitrateKbps: s.voiceBitrateKbps,
      },
      camera: {
        deviceId: s.cameraID,
        quality: s.cameraQuality as CaptureQuality,
        fps: s.cameraFps as CameraFps,
        mirrored: s.cameraFlipped,
      },
      screen: {
        quality: screenQuality as CaptureQuality,
        fps: screenFps as ScreenShareFps,
        codec: s.screenShareCodec,
        gamingMode: s.screenShareGamingMode,
      },
      connection: {
        stunHosts,
        eSportsMode: s.eSportsModeEnabled,
        audioTransportWasm: on ? loadOpusWasm : undefined,
        nativeAudio: on && nativeAudio,
      },
    }),
    [
      s.micID, s.isMuted, s.isServerMuted, s.isDeafened, s.isServerDeafened,
      s.inputMode, s.micVolume, s.outputVolume, s.loopbackEnabled, s.rnnoiseEnabled,
      s.noiseGate, s.noiseGateRelease, s.autoGainEnabled, s.autoGainTargetDb,
      s.compressorEnabled, s.compressorAmount, s.voiceBitrateKbps, s.cameraID, s.cameraQuality,
      s.cameraFps, s.cameraFlipped, screenQuality, screenFps,
      s.screenShareCodec, s.screenShareGamingMode, s.eSportsModeEnabled,
      stunHosts, on,
    ],
  );
}
