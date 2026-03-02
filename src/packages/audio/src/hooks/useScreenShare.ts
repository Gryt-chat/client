import { useCallback, useEffect, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { useSettings } from "@/settings";

import { isElectron } from "../../../../lib/electron";
import { useNativeAudioCapture } from "./useNativeAudioCapture";
import { useSpeakers } from "./useSpeakers";

export type ScreenShareQuality =
  | "native" | "4k" | "1440p" | "1080p" | "720p" | "480p" | "360p" | "240p"
  | "144p" | "96p" | "64p" | "48p" | "32p" | "24p" | "16p" | "8p" | "4p";

export type ScreenShareFps = 30 | 60 | 90 | 120 | 144 | 165 | 240;

export const STANDARD_FPS_OPTIONS: ScreenShareFps[] = [30, 60, 90, 120];
export const EXPERIMENTAL_FPS_OPTIONS: ScreenShareFps[] = [144, 165, 240];

const RESOLUTION_CONSTRAINTS: Record<ScreenShareQuality, { width?: number; height?: number }> = {
  native: {},
  "4k": { width: 3840, height: 2160 },
  "1440p": { width: 2560, height: 1440 },
  "1080p": { width: 1920, height: 1080 },
  "720p": { width: 1280, height: 720 },
  "480p": { width: 854, height: 480 },
  "360p": { width: 640, height: 360 },
  "240p": { width: 426, height: 240 },
  "144p": { width: 256, height: 144 },
  "96p": { width: 170, height: 96 },
  "64p": { width: 114, height: 64 },
  "48p": { width: 85, height: 48 },
  "32p": { width: 57, height: 32 },
  "24p": { width: 43, height: 24 },
  "16p": { width: 28, height: 16 },
  "8p": { width: 14, height: 8 },
  "4p": { width: 7, height: 4 },
};

const BASE_BITRATES_30FPS: Record<ScreenShareQuality, number | null> = {
  native: null,
  "4k": 20_000_000,
  "1440p": 12_000_000,
  "1080p": 6_000_000,
  "720p": 3_000_000,
  "480p": 1_500_000,
  "360p": 800_000,
  "240p": 400_000,
  "144p": 150_000,
  "96p": 80_000,
  "64p": 40_000,
  "48p": 25_000,
  "32p": 15_000,
  "24p": 10_000,
  "16p": 5_000,
  "8p": 2_000,
  "4p": 1_000,
};

const MAX_BITRATE = 20_000_000;

export function estimateBitrate(quality: ScreenShareQuality, fps: number): number | null {
  const base = BASE_BITRATES_30FPS[quality];
  if (base === null) return null;
  return Math.min(Math.round(base * Math.pow(fps / 30, 0.7)), MAX_BITRATE);
}

export interface ScreenShareInterface {
  screenVideoStream: MediaStream | null;
  screenAudioStream: MediaStream | null;
  screenShareActive: boolean;
  /** True when OS-native audio capture is active (no phase cancellation needed). */
  nativeAudioActive: boolean;
  startScreenShare: (withAudio: boolean, sourceId?: string) => Promise<void>;
  stopScreenShare: () => void;
}

function useScreenShareHook(): ScreenShareInterface {
  const { screenShareQuality, screenShareFps, screenShareGamingMode } = useSettings();
  const { audioContext } = useSpeakers();
  const {
    available: nativeAvailable,
    active: nativeActive,
    stream: nativeStream,
    start: nativeStart,
    stop: nativeStop,
  } = useNativeAudioCapture();
  const [screenVideoStream, setScreenVideoStream] = useState<MediaStream | null>(null);
  const [screenAudioStream, setScreenAudioStream] = useState<MediaStream | null>(null);
  const [screenShareActive, setScreenShareActive] = useState(false);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const usingNativeAudioRef = useRef(false);

  const stopScreenShare = useCallback(() => {
    if (usingNativeAudioRef.current) {
      nativeStop();
      usingNativeAudioRef.current = false;
    }
    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach((t) => t.stop());
      rawStreamRef.current = null;
    }
    setScreenVideoStream(null);
    setScreenAudioStream(null);
    setScreenShareActive(false);
  }, [nativeStop]);

  const startScreenShare = useCallback(async (withAudio: boolean, sourceId?: string) => {
    const res = RESOLUTION_CONSTRAINTS[screenShareQuality as ScreenShareQuality] ?? RESOLUTION_CONSTRAINTS.native;
    const fps = screenShareFps || 30;
    const useNativeAudio = withAudio && nativeAvailable;
    console.log(
      `[ScreenShare] startScreenShare withAudio=${withAudio} nativeAvailable=${nativeAvailable} useNativeAudio=${useNativeAudio} isElectron=${isElectron()} sourceId=${sourceId ?? "none"}`,
    );

    try {
      let stream: MediaStream;

      if (isElectron() && sourceId) {
        type ChromeDesktopMandatory = {
          chromeMediaSource: "desktop";
          chromeMediaSourceId: string;
          maxFrameRate?: number;
          maxWidth?: number;
          maxHeight?: number;
        };
        type ChromeDesktopConstraints = MediaTrackConstraints & { mandatory: ChromeDesktopMandatory };

        const mandatory: ChromeDesktopMandatory = {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          maxFrameRate: fps,
        };
        if (res.width) {
          mandatory.maxWidth = res.width;
          mandatory.maxHeight = res.height;
        }

        const video: ChromeDesktopConstraints = { mandatory };

        if (useNativeAudio) {
          stream = await navigator.mediaDevices.getUserMedia({ video });
        } else {
          const audio: ChromeDesktopConstraints = {
            mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId },
          };
          stream = await navigator.mediaDevices.getUserMedia({
            video,
            audio: withAudio ? audio : false,
          });
        }
      } else {
        const videoConstraints: MediaTrackConstraints & { cursor?: string } = {
          frameRate: { ideal: fps },
          cursor: screenShareGamingMode ? "never" : "always",
        };
        if (res.width) {
          videoConstraints.width = { ideal: res.width };
          videoConstraints.height = { ideal: res.height };
        }

        interface DisplayMediaWithSystemAudio extends DisplayMediaStreamOptions {
          systemAudio?: "include" | "exclude";
        }
        const displayOpts: DisplayMediaWithSystemAudio = {
          video: videoConstraints,
          audio: withAudio,
          systemAudio: "exclude",
        };
        stream = await navigator.mediaDevices.getDisplayMedia(displayOpts);
      }

      if (rawStreamRef.current) {
        rawStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      rawStreamRef.current = stream;
      setScreenShareActive(true);

      console.log(
        `[ScreenShare] captured stream id=${stream.id} totalTracks=${stream.getTracks().length} audioTracks=${stream.getAudioTracks().length} videoTracks=${stream.getVideoTracks().length}`,
      );

      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks[0].contentHint = screenShareGamingMode ? "motion" : "detail";

        const videoOnly = new MediaStream(videoTracks);
        setScreenVideoStream(videoOnly);

        videoTracks[0].addEventListener("ended", () => {
          stopScreenShare();
        });
      }

      if (useNativeAudio && audioContext) {
        console.log(`[ScreenShare] attempting native audio capture (sourceId=${sourceId ?? "none"})...`);
        const started = await nativeStart(audioContext, sourceId);
        if (started) {
          console.log("[ScreenShare] native audio capture STARTED");
          usingNativeAudioRef.current = true;
        } else {
          console.warn("[ScreenShare] native audio capture FAILED, falling back to raw loopback");
          usingNativeAudioRef.current = false;
          extractRawAudio(stream);
        }
      } else {
        console.log(
          `[ScreenShare] using raw loopback audio (nativeAvailable=${nativeAvailable} audioContext=${!!audioContext})`,
        );
        extractRawAudio(stream);
      }
    } catch (error) {
      console.error("[ScreenShare] getDisplayMedia failed:", error);
      setScreenShareActive(false);
    }

    function logTrackDetails(label: string, tracks: MediaStreamTrack[]) {
      console.log(
        `[ScreenShare] ${label}: ${tracks.length} track(s)`,
        tracks.map((t) => ({
          id: t.id,
          label: t.label,
          enabled: t.enabled,
          readyState: t.readyState,
          muted: t.muted,
        })),
      );
    }

    function extractRawAudio(mediaStream: MediaStream) {
      const audioTracks = mediaStream.getAudioTracks();
      logTrackDetails("extractRawAudio", audioTracks);
      if (audioTracks.length > 0) {
        const audioStream = new MediaStream(audioTracks);
        console.log(`[ScreenShare] screenAudioStream SET id=${audioStream.id}`);
        setScreenAudioStream(audioStream);
      } else {
        console.warn("[ScreenShare] screenAudioStream SET null (no audio tracks in raw stream)");
        setScreenAudioStream(null);
      }
    }
  }, [screenShareQuality, screenShareFps, screenShareGamingMode, stopScreenShare, nativeAvailable, nativeStart, audioContext]);

  // Sync native capture stream → screenAudioStream
  useEffect(() => {
    if (usingNativeAudioRef.current && nativeStream) {
      const tracks = nativeStream.getAudioTracks();
      console.log(
        `[ScreenShare] native stream synced → screenAudioStream id=${nativeStream.id} audioTracks=${tracks.length}`,
        tracks.map((t) => ({ id: t.id, label: t.label, enabled: t.enabled, readyState: t.readyState, muted: t.muted })),
      );
      setScreenAudioStream(nativeStream);
    }
  }, [nativeStream]);

  useEffect(() => {
    return () => {
      if (rawStreamRef.current) {
        rawStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    screenVideoStream,
    screenAudioStream,
    screenShareActive,
    nativeAudioActive: usingNativeAudioRef.current && nativeActive,
    startScreenShare,
    stopScreenShare,
  };
}

const screenShareInit: ScreenShareInterface = {
  screenVideoStream: null,
  screenAudioStream: null,
  screenShareActive: false,
  nativeAudioActive: false,
  startScreenShare: async () => {},
  stopScreenShare: () => {},
};

export const useScreenShare = singletonHook(screenShareInit, useScreenShareHook);
