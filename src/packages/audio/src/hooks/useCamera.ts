import { useCallback, useEffect, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { useSettings } from "@/settings";

export type CameraQuality = "native" | "1080p" | "720p" | "480p" | "360p";

export const QUALITY_CONSTRAINTS: Record<CameraQuality, { width?: number; height?: number; frameRate: number }> = {
  native: { frameRate: 30 },
  "1080p": { width: 1920, height: 1080, frameRate: 30 },
  "720p": { width: 1280, height: 720, frameRate: 30 },
  "480p": { width: 854, height: 480, frameRate: 30 },
  "360p": { width: 640, height: 360, frameRate: 30 },
};

export interface CameraInterface {
  cameraStream: MediaStream | null;
  cameraEnabled: boolean;
  cameraError: string | null;
  setCameraEnabled: (enabled: boolean) => void;
  retryCamera: () => void;
  devices: MediaDeviceInfo[];
  getDevices: () => Promise<void>;
}

function friendlyCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotReadableError":
    case "AbortError":
      return "Failed to start camera — is it in use by another application?";
    case "NotAllowedError":
      return "Camera access was denied. Check your browser or system permissions.";
    case "NotFoundError":
      return "No camera detected. Make sure one is connected.";
    case "OverconstrainedError":
      return "Camera doesn't support the selected quality. Try a lower setting.";
    default:
      return "Failed to start camera. Please try again.";
  }
}

function useCameraHook(): CameraInterface {
  const { cameraID, setCameraID, cameraQuality } = useSettings();
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraEnabled, setCameraEnabledState] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const getDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter((d) => d.kind === "videoinput");
      setDevices(videoDevices);

      if (videoDevices.length > 0 && !cameraID) {
        setCameraID(videoDevices[0].deviceId);
      }
    } catch {
      // Permission denied or no devices
    }
  }, [cameraID, setCameraID]);

  // Listen for hot-plug
  useEffect(() => {
    const handler = () => { getDevices(); };
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, [getDevices]);

  const startCamera = useCallback(async () => {
    const quality = QUALITY_CONSTRAINTS[cameraQuality as CameraQuality] ?? QUALITY_CONSTRAINTS.native;
    const videoConstraints: MediaTrackConstraints = {
      ...(cameraID ? { deviceId: { exact: cameraID } } : {}),
      frameRate: { ideal: quality.frameRate },
    };
    if (quality.width) {
      videoConstraints.width = { ideal: quality.width };
      videoConstraints.height = { ideal: quality.height };
    }
    const constraints: MediaStreamConstraints = {
      video: videoConstraints,
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      streamRef.current = stream;
      setCameraStream(stream);
      setCameraError(null);

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter((d) => d.kind === "videoinput");
      setDevices(videoDevices);

      const actualDevice = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (actualDevice && actualDevice !== cameraID) {
        setCameraID(actualDevice);
      }
    } catch (error) {
      console.error("[Camera] getUserMedia failed:", error);
      setCameraError(friendlyCameraError(error));
      setCameraEnabledState(false);
    }
  }, [cameraID, cameraQuality, setCameraID]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraStream(null);
  }, []);

  const setCameraEnabled = useCallback((enabled: boolean) => {
    setCameraEnabledState(enabled);
    if (enabled) {
      setCameraError(null);
      startCamera();
    } else {
      stopCamera();
    }
  }, [startCamera, stopCamera]);

  const retryCamera = useCallback(() => {
    setCameraError(null);
    setCameraEnabledState(true);
    startCamera();
  }, [startCamera]);

  // Restart when device or quality changes while camera is on
  useEffect(() => {
    if (cameraEnabled && cameraID) {
      startCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraID, cameraQuality]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    cameraStream,
    cameraEnabled,
    cameraError,
    setCameraEnabled,
    retryCamera,
    devices,
    getDevices,
  };
}

const cameraInit: CameraInterface = {
  cameraStream: null,
  cameraEnabled: false,
  cameraError: null,
  setCameraEnabled: () => {},
  retryCamera: () => {},
  devices: [],
  getDevices: async () => {},
};

export const useCamera = singletonHook(cameraInit, useCameraHook);
