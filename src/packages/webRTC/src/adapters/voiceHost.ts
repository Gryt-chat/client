import type { NativeAudioCapture, NativeScreenCapture, VoiceHost } from "@gryt/voice";

import { getElectronAPI, isElectron } from "../../../../lib/electron";

/**
 * What this client can do that a browser tab cannot. Two questions rather than
 * one `isElectron()`; on the desktop both answers happen to be the same.
 */
export const electronVoiceHost: VoiceHost = {
  hasNativeCapture: () => isElectron(),

  getNativeAudio(): NativeAudioCapture | null {
    const api = getElectronAPI();
    if (!api) return null;
    return {
      isNativeAudioCaptureAvailable: () => api.isNativeAudioCaptureAvailable(),
      startNativeAudioCapture: (sourceId) => api.startNativeAudioCapture(sourceId),
      stopNativeAudioCapture: () => api.stopNativeAudioCapture(),
      onNativeAudioData: (cb) => api.onNativeAudioData(cb),
      onNativeAudioStopped: (cb) => api.onNativeAudioStopped(cb),
      onNativeAudioDiagnostic: (cb) => api.onNativeAudioDiagnostic(cb),
    };
  },

  getNativeScreen(): NativeScreenCapture | null {
    const api = getElectronAPI();
    if (!api) return null;
    return {
      isNativeScreenCaptureAvailable: () => api.isNativeScreenCaptureAvailable(),
      startNativeScreenCapture: (monitorIndex, fps, maxWidth, maxHeight, bitrate, codec) =>
        api.startNativeScreenCapture(monitorIndex, fps, maxWidth, maxHeight, bitrate, codec),
      stopNativeScreenCapture: () => api.stopNativeScreenCapture(),
      onNativeScreenFrame: (cb) => api.onNativeScreenFrame(cb),
      onNativeScreenCaptureStopped: (cb) => api.onNativeScreenCaptureStopped(cb),
    };
  },

  /**
   * Whether a plain ws:// to a private address is allowed. Inside Electron there
   * is no mixed-content rule. On React Native the two answers differ.
   */
  allowsInsecureTransport: () => isElectron(),
};
