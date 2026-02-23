import { useCallback, useEffect, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { useSettings } from "@/settings";

import { isElectron } from "../../../../lib/electron";

export type ScreenShareQuality = "native" | "4k" | "1440p" | "1080p" | "720p" | "480p";

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
};

const BASE_BITRATES_30FPS: Record<ScreenShareQuality, number | null> = {
  native: null,
  "4k": 20_000_000,
  "1440p": 12_000_000,
  "1080p": 6_000_000,
  "720p": 3_000_000,
  "480p": 1_500_000,
};

export function estimateBitrate(quality: ScreenShareQuality, fps: number): number | null {
  const base = BASE_BITRATES_30FPS[quality];
  if (base === null) return null;
  return Math.round(base * (fps / 30));
}

export interface ScreenShareInterface {
  screenVideoStream: MediaStream | null;
  screenAudioStream: MediaStream | null;
  screenShareActive: boolean;
  startScreenShare: (withAudio: boolean, sourceId?: string) => Promise<void>;
  stopScreenShare: () => void;
}

function useScreenShareHook(): ScreenShareInterface {
  const { screenShareQuality, screenShareFps } = useSettings();
  const [screenVideoStream, setScreenVideoStream] = useState<MediaStream | null>(null);
  const [screenAudioStream, setScreenAudioStream] = useState<MediaStream | null>(null);
  const [screenShareActive, setScreenShareActive] = useState(false);
  const rawStreamRef = useRef<MediaStream | null>(null);

  const stopScreenShare = useCallback(() => {
    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach((t) => t.stop());
      rawStreamRef.current = null;
    }
    setScreenVideoStream(null);
    setScreenAudioStream(null);
    setScreenShareActive(false);
  }, []);

  const startScreenShare = useCallback(async (withAudio: boolean, sourceId?: string) => {
    const res = RESOLUTION_CONSTRAINTS[screenShareQuality as ScreenShareQuality] ?? RESOLUTION_CONSTRAINTS.native;
    const fps = screenShareFps || 30;

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
        const audio: ChromeDesktopConstraints = {
          mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId },
        };

        const constraints: MediaStreamConstraints = {
          video,
          audio: withAudio ? audio : false,
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } else {
        const videoConstraints: MediaTrackConstraints = {
          frameRate: { ideal: fps },
        };
        if (res.width) {
          videoConstraints.width = { ideal: res.width };
          videoConstraints.height = { ideal: res.height };
        }

        stream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: withAudio,
        });
      }

      if (rawStreamRef.current) {
        rawStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      rawStreamRef.current = stream;
      setScreenShareActive(true);

      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
        const videoOnly = new MediaStream(videoTracks);
        setScreenVideoStream(videoOnly);

        videoTracks[0].addEventListener("ended", () => {
          stopScreenShare();
        });
      }

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const audioOnly = new MediaStream(audioTracks);
        setScreenAudioStream(audioOnly);
      } else {
        setScreenAudioStream(null);
      }
    } catch (error) {
      console.error("[ScreenShare] getDisplayMedia failed:", error);
      setScreenShareActive(false);
    }
  }, [screenShareQuality, screenShareFps, stopScreenShare]);

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
    startScreenShare,
    stopScreenShare,
  };
}

const screenShareInit: ScreenShareInterface = {
  screenVideoStream: null,
  screenAudioStream: null,
  screenShareActive: false,
  startScreenShare: async () => {},
  stopScreenShare: () => {},
};

export const useScreenShare = singletonHook(screenShareInit, useScreenShareHook);
