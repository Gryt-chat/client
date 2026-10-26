import { type ScreenWindow, useScreenShare, useSFU } from "@gryt/voice";
import { useEffect, useRef } from "react";

import { useSettings } from "@/settings";

import { senderStreamId } from "../utils/senderStreamIds";
import { liftScreenCapture, screenSendSettings } from "../utils/streamQuality";
import { shareMeta, useShareWindowsVersion, windowKey } from "./shareWindows";

export interface AnnouncedShare {
  videoStreamId: string;
  audioStreamId: string;
}

/**
 * Publishes each window shared after the first on senders of its own and lists them for
 * `voice:screen:state` (GRYT-1905). Window 0 stays with the controls' own effects.
 */
export function useExtraScreenWindows(): AnnouncedShare[] {
  const { extraWindows } = useScreenShare();
  const {
    isConnected, getPeerConnection, setVideoSendSettings,
    addScreenVideoTrack, removeScreenVideoTrack, addScreenAudioTrack, removeScreenAudioTrack,
  } = useSFU();
  const {
    screenShareQuality, screenShareFps, screenShareGamingMode, screenShareCodec, screenShareMaxBitrate, screenShareScalabilityMode,
  } = useSettings();
  const shareVersion = useShareWindowsVersion();
  const published = useRef(new Map<number, ScreenWindow>());

  useEffect(() => {
    if (!isConnected) {
      published.current.clear();
      return;
    }
    const live = new Set(extraWindows.map((w) => w.index));
    for (const index of [...published.current.keys()]) {
      if (live.has(index)) continue;
      removeScreenVideoTrack(index);
      removeScreenAudioTrack(index);
      setVideoSendSettings?.(`screen:${index}`, null);
      published.current.delete(index);
    }
    for (const w of extraWindows) {
      const video = w.videoStream.getVideoTracks()[0];
      if (video) addScreenVideoTrack(video, w.videoStream, screenShareCodec, w.index);
      const audio = w.audioStream?.getAudioTracks()[0];
      if (audio && w.audioStream) addScreenAudioTrack(audio, w.audioStream, w.index);
      const preset = shareMeta(windowKey(w));
      const quality = preset?.quality ?? screenShareQuality;
      const fps = preset?.fps ?? screenShareFps;
      const settings = screenSendSettings({
        quality, fps, gamingMode: screenShareGamingMode, codec: screenShareCodec,
        maxBitrate: screenShareMaxBitrate, scalabilityMode: screenShareScalabilityMode, nativeH264: false,
      });
      // Opened at the saved quality, so a higher pick has to widen the capture first.
      if (video) void liftScreenCapture(video, quality, fps).then(() => setVideoSendSettings?.(`screen:${w.index}`, settings));
      published.current.set(w.index, w);
    }
  }, [extraWindows, isConnected, addScreenVideoTrack, removeScreenVideoTrack, addScreenAudioTrack, removeScreenAudioTrack, setVideoSendSettings, shareVersion, screenShareQuality, screenShareFps, screenShareGamingMode, screenShareCodec, screenShareMaxBitrate, screenShareScalabilityMode]);

  // A sender keeps the first stream id it was given, so a reused index announces that one.
  const pc = getPeerConnection?.();
  return extraWindows.map((w) => ({
    videoStreamId: senderStreamId(pc, `screenVideo:${w.index}`, w.videoStream.id),
    audioStreamId: w.audioStream ? senderStreamId(pc, `screenAudio:${w.index}`, w.audioStream.id) : "",
  }));
}
