import { useCallback, useEffect, useRef, useState } from "react";

import { getElectronAPI, isElectron } from "../../../../lib/electron";
import { getWorkletUrl, PCM_PLAYER_WORKLET_NAME } from "../processors/pcmPlayerProcessor";

export interface NativeAudioCapture {
  /** Whether the native binary is present on this platform. */
  available: boolean;
  /** Whether native capture is currently running. */
  active: boolean;
  /** The MediaStream produced by the native capture (null when inactive). */
  stream: MediaStream | null;
  start: (audioContext: AudioContext, sourceId?: string) => Promise<boolean>;
  stop: () => void;
}

/**
 * Manages a native audio capture session.  When a window sourceId is provided,
 * captures ONLY that application's audio; otherwise captures all system audio
 * except Gryt's own process tree.  Returns a MediaStream suitable for WebRTC.
 *
 * On platforms without a native binary this hook is a no-op (available = false).
 */
export function useNativeAudioCapture(): NativeAudioCapture {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const cleanupIpcRef = useRef<Array<() => void>>([]);

  // Probe availability on mount, with retry for IPC race conditions
  useEffect(() => {
    if (!isElectron()) return;
    const api = getElectronAPI();
    if (!api) return;

    let cancelled = false;

    async function probe(attempt: number) {
      try {
        const v = await api!.isNativeAudioCaptureAvailable();
        if (!cancelled) {
          console.log(`[NativeAudioCapture] availability probe: ${v}`);
          setAvailable(v);
        }
      } catch (err) {
        if (cancelled) return;
        if (attempt < 3) {
          console.warn(`[NativeAudioCapture] probe attempt ${attempt} failed, retrying...`, err);
          setTimeout(() => probe(attempt + 1), 500 * attempt);
        } else {
          console.error("[NativeAudioCapture] probe failed after retries", err);
        }
      }
    }

    probe(1);
    return () => { cancelled = true; };
  }, []);

  const stop = useCallback(() => {
    const api = getElectronAPI();
    api?.stopNativeAudioCapture();

    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "stop" });
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    destinationRef.current = null;

    for (const unsub of cleanupIpcRef.current) unsub();
    cleanupIpcRef.current = [];

    setStream(null);
    setActive(false);
  }, []);

  const start = useCallback(
    async (audioContext: AudioContext, sourceId?: string): Promise<boolean> => {
      const api = getElectronAPI();
      if (!api) return false;

      try {
        await audioContext.audioWorklet.addModule(getWorkletUrl());
      } catch {
        // Already registered
      }

      const workletNode = new AudioWorkletNode(audioContext, PCM_PLAYER_WORKLET_NAME, {
        outputChannelCount: [2],
      });
      const destination = audioContext.createMediaStreamDestination();
      workletNode.connect(destination);

      workletNodeRef.current = workletNode;
      destinationRef.current = destination;

      let pcmChunks = 0;
      let pcmTotalBytes = 0;
      let logIntervalId: ReturnType<typeof setInterval> | null = null;

      logIntervalId = setInterval(() => {
        if (pcmChunks > 0) {
          console.log(
            `[NativeAudioCapture] PCM stats: ${pcmChunks} chunks, ${(pcmTotalBytes / 1024).toFixed(0)} KB total`,
          );
        } else {
          console.warn("[NativeAudioCapture] PCM stats: 0 chunks received (no audio data flowing)");
        }
      }, 5000);

      const unsubData = api.onNativeAudioData((pcmArrayBuffer: ArrayBuffer) => {
        pcmChunks++;
        pcmTotalBytes += pcmArrayBuffer.byteLength;
        if (pcmChunks === 1) {
          console.log(
            `[NativeAudioCapture] first PCM chunk in renderer: ${pcmArrayBuffer.byteLength} bytes`,
          );
        }
        const int16 = new Int16Array(pcmArrayBuffer);
        workletNode.port.postMessage({ type: "pcm", samples: int16 }, [int16.buffer]);
      });

      const unsubStopped = api.onNativeAudioStopped(() => {
        stop();
      });

      cleanupIpcRef.current = [
        unsubData,
        unsubStopped,
        () => { if (logIntervalId) clearInterval(logIntervalId); },
      ];

      const started = await api.startNativeAudioCapture(sourceId);
      if (!started) {
        stop();
        return false;
      }

      setStream(destination.stream);
      setActive(true);
      return true;
    },
    [stop],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { available, active, stream, start, stop };
}
