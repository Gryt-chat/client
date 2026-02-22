import { useCallback, useEffect, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { useSettings } from "@/settings";

export type ScreenShareQuality = "native" | "1080p" | "720p" | "480p";

const QUALITY_CONSTRAINTS: Record<ScreenShareQuality, { width?: number; height?: number; frameRate: number }> = {
  native: { frameRate: 30 },
  "1080p": { width: 1920, height: 1080, frameRate: 30 },
  "720p": { width: 1280, height: 720, frameRate: 30 },
  "480p": { width: 854, height: 480, frameRate: 15 },
};

export const QUALITY_BITRATES: Record<ScreenShareQuality, number | null> = {
  native: null,
  "1080p": 6_000_000,
  "720p": 3_000_000,
  "480p": 1_500_000,
};

export interface ScreenShareInterface {
  screenVideoStream: MediaStream | null;
  screenAudioStream: MediaStream | null;
  screenShareActive: boolean;
  startScreenShare: (withAudio: boolean) => Promise<void>;
  stopScreenShare: () => void;
}

function useScreenShareHook(): ScreenShareInterface {
  const { screenShareQuality } = useSettings();
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

  const startScreenShare = useCallback(async (withAudio: boolean) => {
    const q = QUALITY_CONSTRAINTS[screenShareQuality as ScreenShareQuality] ?? QUALITY_CONSTRAINTS.native;

    const videoConstraints: MediaTrackConstraints = {
      frameRate: { ideal: q.frameRate },
    };
    if (q.width) {
      videoConstraints.width = { ideal: q.width };
      videoConstraints.height = { ideal: q.height };
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraints,
        audio: withAudio,
      });

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
  }, [screenShareQuality, stopScreenShare]);

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
