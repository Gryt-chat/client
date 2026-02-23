import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { getIsBrowserSupported } from "@/audio";
import { useSettings } from "@/settings";
import { voiceLog } from "@/webRTC/src/hooks/voiceLogger";

import { RNNoiseProcessor } from "../processors/rnnoiseProcessor";
import { MicrophoneBufferType, MicrophoneInterface } from "../types/Microphone";
import { createMicrophoneBuffer, usePipelineControls } from "./microphonePipeline";
import { useSharedAudioContext } from "./useAudioContext";
import { useHandles } from "./useHandles";
import { usePushToTalk } from "./usePushToTalk";

function useCreateMicrophoneHook() {
  const { handles, addHandle, removeHandle, isLoaded } = useHandles();
  const { 
    loopbackEnabled, 
    micID, 
    micVolume, 
    isMuted,
    isServerMuted,
    noiseGate,
    rnnoiseEnabled,
    inputMode,
    eSportsModeEnabled,
    autoGainEnabled,
    autoGainTargetDb,
    compressorEnabled,
    compressorAmount,
  } = useSettings();
  const effectiveMuted = isMuted || isServerMuted;
  
  const audioContext = useSharedAudioContext();
  const [devices, setDevices] = useState<InputDeviceInfo[]>([]);
  const [micStream, setMicStream] = useState<MediaStream | undefined>(undefined);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | undefined>(micID);
  
  const rnnoiseProcessorRef = useRef<RNNoiseProcessor | null>(null);
  const [rnnoiseNode, setRnnoiseNode] = useState<AudioWorkletNode | null>(null);
  
  const isBrowserSupported = useMemo(() => getIsBrowserSupported(), []);

  // Initialize / tear down RNNoise AudioWorklet + Worker
  useEffect(() => {
    if (!rnnoiseEnabled || !audioContext) {
      if (rnnoiseProcessorRef.current) {
        voiceLog.info("MIC", "Destroying RNNoise processor");
        rnnoiseProcessorRef.current.destroy();
        rnnoiseProcessorRef.current = null;
      }
      setRnnoiseNode(null);
      return;
    }

    let cancelled = false;
    const processor = new RNNoiseProcessor();
    rnnoiseProcessorRef.current = processor;

    voiceLog.step("MIC", 1, "Initializing RNNoise AudioWorklet + Worker", {
      sampleRate: audioContext.sampleRate,
    });

    processor
      .initialize(audioContext)
      .then(() => {
        if (cancelled) {
          processor.destroy();
          return;
        }
        processor.setEnabled(true);
        setRnnoiseNode(processor.getNode());
        voiceLog.ok("MIC", 1, "RNNoise AudioWorklet + Worker ready");
      })
      .catch((error) => {
        voiceLog.fail("MIC", 1, "Failed to initialize RNNoise processor", error);
      });

    return () => {
      cancelled = true;
      processor.destroy();
      rnnoiseProcessorRef.current = null;
      setRnnoiseNode(null);
    };
  }, [rnnoiseEnabled, audioContext]);

  // Audio processing pipeline buffer
  const microphoneBuffer = useMemo<MicrophoneBufferType>(() => {
    if (!audioContext) {
      voiceLog.info("MIC", "No AudioContext yet — pipeline deferred");
      return {};
    }
    voiceLog.step("PIPELINE", 1, "Creating audio processing pipeline", {
      hasMicStream: !!micStream,
      micStreamTracks: micStream?.getAudioTracks().length ?? 0,
      rnnoiseActive: !!rnnoiseNode,
    });
    const buf = createMicrophoneBuffer({
      audioContext,
      micStream,
      rnnoiseNode,
      eSportsModeEnabled,
      autoGainEnabled,
      compressorEnabled,
    });
    voiceLog.ok("PIPELINE", 1, "Audio pipeline created", {
      hasProcessedStream: !!buf.processedStream,
      processedStreamTracks: buf.processedStream?.getAudioTracks().length ?? 0,
    });
    return buf;
  }, [audioContext, micStream, rnnoiseNode, eSportsModeEnabled, autoGainEnabled, compressorEnabled]);

  // Pipeline controls (volume, mute, noise gate, loopback, visualizer)
  const { getVisualizerData } = usePipelineControls({
    microphoneBuffer,
    audioContext,
    micStream,
    micVolume,
    isMuted: effectiveMuted,
    noiseGate,
    loopbackEnabled,
    inputMode,
    autoGainEnabled,
    autoGainTargetDb,
    compressorAmount,
  });

  // Push-to-talk: controls muteGain directly via keydown/keyup
  const { isPttActive } = usePushToTalk(microphoneBuffer, audioContext);

  // Device enumeration with permission handling
  const getDevices = useCallback(async () => {
    if (!isBrowserSupported) {
      return;
    }

    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });

      try {
        permissionStream.getTracks().forEach(track => track.stop());
      } catch (e) {
        // ignore
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioDevices = allDevices.filter((d) => d.kind === "audioinput") as InputDeviceInfo[];
      setDevices(audioDevices);

      if (audioDevices.length > 0) {
        let selectedDeviceId = micID;
        
        if (selectedDeviceId && !audioDevices.find(d => d.deviceId === selectedDeviceId)) {
          selectedDeviceId = audioDevices[0].deviceId;
        } else if (!selectedDeviceId) {
          selectedDeviceId = audioDevices[0].deviceId;
        }

        if (selectedDeviceId !== currentDeviceId) {
          setCurrentDeviceId(selectedDeviceId);
        }
      }
    } catch (error) {
      console.error("Error enumerating devices:", error);
    }
  }, [isBrowserSupported, currentDeviceId, micID]);

  // Synchronize currentDeviceId with micID from settings
  useEffect(() => {
    if (micID && micID !== currentDeviceId) {
      setCurrentDeviceId(micID);
    }
  }, [micID, currentDeviceId]);

  // When a microphone handle is requested but no device is selected yet,
  // enumerate devices and auto-select one on demand.
  useEffect(() => {
    if (handles.length > 0 && !currentDeviceId) {
      getDevices();
    }
  }, [handles.length, currentDeviceId, getDevices]);

  // Enhanced device management with localStorage integration
  useEffect(() => {
    async function initializeDevice(deviceId: string | undefined) {
      if (!deviceId) {
        voiceLog.info("MIC", "No device ID — skipping initialization");
        return;
      }

      voiceLog.step("MIC", 2, "Requesting getUserMedia", { deviceId });
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
            channelCount: 1,
            sampleRate: 48000,
            sampleSize: 16,
          },
        });

        const tracks = stream.getAudioTracks();
        voiceLog.ok("MIC", 2, "getUserMedia succeeded", {
          trackCount: tracks.length,
          tracks: tracks.map(t => ({ id: t.id, label: t.label, readyState: t.readyState })),
        });

        if (micStream) {
          micStream.getTracks().forEach(track => track.stop());
        }

        setMicStream(stream);
        
        if (deviceId !== micID) {
          localStorage.setItem("micID", deviceId);
        }

      } catch (error) {
        voiceLog.fail("MIC", 2, `getUserMedia failed for device ${deviceId}`, error);
        
        voiceLog.step("MIC", "2b", "Trying fallback (default device)");
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
              channelCount: 1,
              sampleRate: 48000,
              sampleSize: 16,
            },
          });
          
          voiceLog.ok("MIC", "2b", "Fallback getUserMedia succeeded", {
            tracks: fallbackStream.getAudioTracks().map(t => ({ id: t.id, label: t.label })),
          });

          if (micStream) {
            micStream.getTracks().forEach(track => track.stop());
          }
          setMicStream(fallbackStream);
          
        } catch (fallbackError) {
          voiceLog.fail("MIC", "2b", "Fallback getUserMedia also failed — no microphone!", fallbackError);
        }
      }
    }

    if (handles.length > 0) {
      voiceLog.info("MIC", `Active handles: ${handles.length} — initializing device`);
      initializeDevice(currentDeviceId);
    } else {
      if (micStream) {
        voiceLog.info("MIC", "No active handles — releasing microphone");
        micStream.getTracks().forEach(track => track.stop());
        setMicStream(undefined);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handles.length, currentDeviceId]);

  // Monitor track state and reinitialize if tracks are stopped externally
  useEffect(() => {
    if (!micStream || handles.length === 0) {
      return;
    }

    const tracks = micStream.getAudioTracks();
    if (tracks.length === 0) {
      return;
    }

    const checkInterval = setInterval(() => {
      const currentTracks = micStream.getAudioTracks();
      const hasLiveTracks = currentTracks.length > 0 && currentTracks.some(track => track.readyState === 'live');
      
      if (!hasLiveTracks && handles.length > 0) {
        setMicStream(undefined);
      }
    }, 1000);

    return () => {
      clearInterval(checkInterval);
    };
  }, [micStream, handles.length]);

  return {
    addHandle,
    removeHandle,
    microphoneBuffer,
    isBrowserSupported,
    devices,
    audioContext,
    isLoaded,
    getDevices,
    getVisualizerData,
    isPttActive,
  };
}

// Enhanced initialization with mute support
const init: MicrophoneInterface = {
  devices: [],
  isBrowserSupported: undefined,
  microphoneBuffer: {
    input: undefined,
    output: undefined,
    rawOutput: undefined,
    analyser: undefined,
    finalAnalyser: undefined,
    mediaStream: undefined,
    processedStream: undefined,
    muteGain: undefined,
    volumeGain: undefined,
    noiseGate: undefined,
    rnnoiseNode: undefined,
  },
  audioContext: undefined,
  addHandle: () => {},
  removeHandle: () => {},
  isLoaded: false,
  getDevices: async () => {},
  getVisualizerData: () => null,
  isPttActive: { current: false },
};

// Singleton hook instance
const singletonMicrophone = singletonHook(init, useCreateMicrophoneHook);

// Enhanced consumer hook with automatic handle management
export const useMicrophone = (shouldAccess: boolean = false) => {
  const mic = singletonMicrophone();
  const handleIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldAccess) {
      if (handleIdRef.current) {
        mic.removeHandle(handleIdRef.current);
        handleIdRef.current = null;
      }
      return;
    }

    if (!handleIdRef.current) {
      const id = self.crypto.randomUUID();
      handleIdRef.current = id;
      mic.addHandle(id);
    }

    return () => {
      if (handleIdRef.current) {
        mic.removeHandle(handleIdRef.current);
        handleIdRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAccess]);

  return mic;
};
