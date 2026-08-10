import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { getIsBrowserSupported } from "@/audio";
import { useSettings } from "@/settings";
import { voiceLog } from "@/webRTC/src/hooks/voiceLogger";

import {
  createNoiseGateNode,
  ensureNoiseGateWorklet,
} from "../processors/noiseGateProcessor";
import { RNNoiseProcessor } from "../processors/rnnoiseProcessor";
import {
  MicrophoneBufferType,
  MicrophoneInterface,
  MicrophoneUnavailableReason,
} from "../types/Microphone";
import {
  createMicrophoneBuffer,
  usePipelineControls,
} from "./microphonePipeline";
import { useSharedAudioContext } from "./useAudioContext";
import { useHandles } from "./useHandles";
import { usePushToTalk } from "./usePushToTalk";

const MIC_RELEASE_GRACE_MS = 30_000;

/**
 * getUserMedia rejects with a DOMException whose `name` says what went wrong.
 * Only the two cases worth giving different advice for are singled out;
 * everything else is "failed", because guessing further would put words in the
 * browser's mouth.
 */
function classifyMicFailure(error: unknown): MicrophoneUnavailableReason {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "no-device";
  }
  return "failed";
}

/**
 * Virtual and loopback inputs, by the names they ship under.
 *
 * These are real capture devices as far as the browser is concerned, so they
 * enumerate like any other microphone and can sort first. Picking one by
 * default gives you a device that opens cleanly and carries no sound, which is
 * the failure GRYT-61 is about — on macOS with BlackHole installed it is a
 * common way to end up silent without any hint.
 */
const VIRTUAL_INPUT_PATTERNS = [
  "blackhole",
  "soundflower",
  "loopback",
  "vb-audio",
  "vb-cable",
  "cable output",
  "virtual audio",
  "voicemeeter",
  "ishowu",
];

function isVirtualInput(device: MediaDeviceInfo): boolean {
  const label = device.label.toLowerCase();
  return VIRTUAL_INPUT_PATTERNS.some((pattern) => label.includes(pattern));
}

/**
 * The device to fall back on when nothing is stored, or when the stored one has
 * gone away.
 *
 * Prefers the first real input over the first device. If every input is
 * virtual, the first one is still returned — someone whose only input is
 * BlackHole is presumably using it on purpose, and refusing to pick anything
 * would be worse than picking the thing they have.
 */
function pickDefaultDevice(
  devices: InputDeviceInfo[],
): InputDeviceInfo | undefined {
  return devices.find((d) => !isVirtualInput(d)) ?? devices[0];
}

function useCreateMicrophoneHook() {
  const { handles, addHandle, removeHandle, isLoaded } = useHandles();

  const {
    loopbackEnabled,
    micID,
    micVolume,
    isMuted,
    isServerMuted,
    noiseGate,
    noiseGateRelease,
    rnnoiseEnabled,
    inputMode,
    eSportsModeEnabled,
    autoGainEnabled,
    autoGainTargetDb,
    compressorEnabled,
    compressorAmount,
  } = useSettings();

  const effectiveMuted = isMuted || isServerMuted;
  const { audioContext, activate: activateAudioContext } =
    useSharedAudioContext();

  const [devices, setDevices] = useState<InputDeviceInfo[]>([]);
  const [micStream, setMicStream] = useState<MediaStream | undefined>(
    undefined,
  );
  const [currentDeviceId, setCurrentDeviceId] = useState<string | undefined>(
    micID,
  );
  const [micRecoveryTick, setMicRecoveryTick] = useState(0);

  const rnnoiseProcessorRef = useRef<RNNoiseProcessor | null>(null);
  const [rnnoiseNode, setRnnoiseNode] = useState<AudioWorkletNode | null>(null);
  const [noiseGateNode, setNoiseGateNode] = useState<AudioWorkletNode | null>(
    null,
  );
  const [isGateOpen, setIsGateOpen] = useState(false);
  const [micUnavailable, setMicUnavailable] =
    useState<MicrophoneUnavailableReason | null>(null);
  const gateOpenRef = useRef(false);
  const gateLevelRef = useRef(0);

  const releaseMicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micStreamRef = useRef<MediaStream | undefined>(undefined);

  micStreamRef.current = micStream;

  const isBrowserSupported = useMemo(() => getIsBrowserSupported(), []);

  const clearPendingMicRelease = useCallback(() => {
    if (releaseMicTimerRef.current) {
      clearTimeout(releaseMicTimerRef.current);
      releaseMicTimerRef.current = null;
    }
  }, []);

  const stopMicStream = useCallback((reason: string) => {
    const stream = micStreamRef.current;
    if (!stream) return;

    voiceLog.info("MIC", reason);
    stream.getTracks().forEach((track) => track.stop());
    micStreamRef.current = undefined;
    setMicStream(undefined);
  }, []);

  useEffect(() => {
    return () => {
      clearPendingMicRelease();
    };
  }, [clearPendingMicRelease]);

  // Initialize / tear down RNNoise AudioWorklet + Worker.
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
        voiceLog.fail(
          "MIC",
          1,
          "Failed to initialize RNNoise processor",
          error,
        );
      });

    return () => {
      cancelled = true;
      processor.destroy();
      rnnoiseProcessorRef.current = null;
      setRnnoiseNode(null);
    };
  }, [rnnoiseEnabled, audioContext]);

  // Register the noise gate worklet. The gate has to run on the audio thread,
  // otherwise it stops applying whenever the window is hidden (GRYT-18).
  useEffect(() => {
    if (!audioContext) {
      setNoiseGateNode(null);
      return;
    }

    let cancelled = false;

    ensureNoiseGateWorklet(audioContext)
      .then(() => {
        if (cancelled) return;

        const node = createNoiseGateNode(audioContext);

        // The gate is the only thing that actually knows whether audio is
        // leaving this client, so the UI reads its state rather than
        // re-deriving "speaking" from an analyser with its own threshold.
        node.port.onmessage = (event) => {
          const data = event.data;
          if (!data) return;

          if (typeof data.level === "number") {
            gateLevelRef.current = data.level;
          }
          if (typeof data.open === "boolean") {
            gateOpenRef.current = data.open;
            // Only a state update on transitions — level arrives ~47x/sec and
            // must not re-render anything.
            setIsGateOpen((prev) => (prev === data.open ? prev : data.open));
          }
        };

        setNoiseGateNode(node);
        voiceLog.ok("MIC", 1, "Noise gate AudioWorklet ready");
      })
      .catch((error) => {
        // Falls back to the main-thread gate, which can't gate while hidden.
        voiceLog.fail(
          "MIC",
          1,
          "Failed to register noise gate worklet — falling back to main thread",
          error,
        );
      });

    return () => {
      cancelled = true;
      setNoiseGateNode(null);
      setIsGateOpen(false);
      gateOpenRef.current = false;
      gateLevelRef.current = 0;
    };
  }, [audioContext]);

  /**
   * Level the gate is actually deciding on, 0-100. Returns null when the
   * worklet is unavailable so callers can fall back to their own measurement.
   */
  const getGateLevel = useCallback(
    () => (noiseGateNode ? gateLevelRef.current : null),
    [noiseGateNode],
  );

  /**
   * Whether audio is leaving this client right now: the gate is open and the
   * user is not muted. Null when the worklet is unavailable.
   */
  const isTransmitting = noiseGateNode ? isGateOpen && !effectiveMuted : null;

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
      noiseGateNode,
      eSportsModeEnabled,
      autoGainEnabled,
      compressorEnabled,
    });

    voiceLog.ok("PIPELINE", 1, "Audio pipeline created", {
      hasProcessedStream: !!buf.processedStream,
      processedStreamTracks: buf.processedStream?.getAudioTracks().length ?? 0,
    });

    return buf;
  }, [
    audioContext,
    micStream,
    rnnoiseNode,
    noiseGateNode,
    eSportsModeEnabled,
    autoGainEnabled,
    compressorEnabled,
  ]);

  const { getVisualizerData } = usePipelineControls({
    microphoneBuffer,
    audioContext,
    micStream,
    micVolume,
    isMuted: effectiveMuted,
    noiseGate,
    noiseGateRelease,
    loopbackEnabled,
    inputMode,
    eSportsModeEnabled,
    autoGainEnabled,
    autoGainTargetDb,
    compressorAmount,
  });

  const { isPttActive } = usePushToTalk(microphoneBuffer, audioContext);

  const getDevices = useCallback(async () => {
    if (!isBrowserSupported) return;

    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });

      try {
        permissionStream.getTracks().forEach((track) => track.stop());
      } catch {
        // ignore
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioDevices = allDevices.filter(
        (d) => d.kind === "audioinput",
      ) as InputDeviceInfo[];

      setDevices(audioDevices);

      // Permission can be granted with nothing plugged in, so an empty list is
      // its own failure rather than a variant of "denied".
      setMicUnavailable(audioDevices.length > 0 ? null : "no-device");

      if (audioDevices.length > 0) {
        let selectedDeviceId = micID;

        const fallbackDeviceId = pickDefaultDevice(audioDevices)?.deviceId;

        if (
          selectedDeviceId &&
          !audioDevices.find((d) => d.deviceId === selectedDeviceId)
        ) {
          selectedDeviceId = fallbackDeviceId;
        } else if (!selectedDeviceId) {
          selectedDeviceId = fallbackDeviceId;
        }

        if (selectedDeviceId !== currentDeviceId) {
          setCurrentDeviceId(selectedDeviceId);
        }
      }
    } catch (error) {
      console.error("Error enumerating devices:", error);
      // This is the earliest and most reliable place to learn there is no
      // usable microphone. The acquisition path below never even runs in that
      // case — with no device to select, nothing registers a microphone handle
      // — which is why a client with permission denied used to join voice
      // looking perfectly healthy.
      setMicUnavailable(classifyMicFailure(error));
    }
  }, [isBrowserSupported, currentDeviceId, micID]);

  useEffect(() => {
    if (micID && micID !== currentDeviceId) {
      setCurrentDeviceId(micID);
    }
  }, [micID, currentDeviceId]);

  // Re-enumerate when devices come and go, so plugging in headphones shows
  // them without reopening the app. useCamera does the same for video.
  useEffect(() => {
    if (!isBrowserSupported) return;
    if (!navigator.mediaDevices?.addEventListener) return;

    const handleDeviceChange = () => {
      voiceLog.info("MIC", "Input devices changed — re-enumerating");
      getDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [isBrowserSupported, getDevices]);

  useEffect(() => {
    if (handles.length > 0 && !currentDeviceId) {
      getDevices();
    }
  }, [handles.length, currentDeviceId, getDevices]);

  useEffect(() => {
    async function initializeDevice(deviceId: string | undefined) {
      if (!deviceId) {
        voiceLog.info("MIC", "No device ID — skipping initialization");
        // Deliberately does not report "no microphone". This runs during normal
        // startup, before enumeration has produced a device to select, and on a
        // machine with a perfectly good microphone:
        //
        //   Active handles: 2 — initializing device
        //   No device ID — skipping initialization     <- here
        //   Step 2: Requesting getUserMedia
        //   Step 2: getUserMedia succeeded
        //
        // Treating it as a failure raised "No microphone found" for the ~340ms
        // before enumeration caught up, so joining voice in that window warned
        // about a microphone that was about to work. getDevices and the
        // acquisition failure below are the signals that actually know.
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
          tracks: tracks.map((t) => ({
            id: t.id,
            label: t.label,
            readyState: t.readyState,
          })),
        });

        const previous = micStreamRef.current;
        if (previous && previous !== stream) {
          previous.getTracks().forEach((track) => track.stop());
        }

        micStreamRef.current = stream;
        setMicStream(stream);
        setMicUnavailable(null);

        if (deviceId !== micID) {
          localStorage.setItem("micID", deviceId);
        }
      } catch (error) {
        voiceLog.fail(
          "MIC",
          2,
          `getUserMedia failed for device ${deviceId}`,
          error,
        );
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
            tracks: fallbackStream.getAudioTracks().map((t) => ({
              id: t.id,
              label: t.label,
            })),
          });

          const previous = micStreamRef.current;
          if (previous && previous !== fallbackStream) {
            previous.getTracks().forEach((track) => track.stop());
          }

          micStreamRef.current = fallbackStream;
          setMicStream(fallbackStream);
          setMicUnavailable(null);
        } catch (fallbackError) {
          voiceLog.fail(
            "MIC",
            "2b",
            "Fallback getUserMedia also failed — no microphone!",
            fallbackError,
          );
          // This used to end here, so a client with no working microphone
          // joined voice looking entirely healthy while nobody could hear it.
          setMicUnavailable(classifyMicFailure(fallbackError));
        }
      }
    }

    if (handles.length > 0) {
      clearPendingMicRelease();
      activateAudioContext();

      if (audioContext?.state === "suspended") {
        audioContext.resume().catch(() => {});
      }

      const existing = micStreamRef.current;
      const liveTrack = existing
        ?.getAudioTracks()
        .find((track) => track.readyState === "live");

      if (liveTrack) {
        // A live track isn't enough — it has to be the device the user picked,
        // otherwise selecting a new microphone silently keeps the old one.
        const activeDeviceId = liveTrack.getSettings().deviceId;

        // "default" is a moving target: it resolves to whatever the OS
        // currently considers default, so it can't be compared by id. Only
        // re-acquire when both ids are known and actually differ.
        const deviceMatches =
          !currentDeviceId ||
          currentDeviceId === "default" ||
          !activeDeviceId ||
          activeDeviceId === currentDeviceId;

        if (deviceMatches) {
          voiceLog.info(
            "MIC",
            `Active handles: ${handles.length} — keeping existing live microphone`,
          );
          return;
        }

        voiceLog.info(
          "MIC",
          `Selected device changed (${activeDeviceId} → ${currentDeviceId}) — re-acquiring`,
        );
        stopMicStream("Switching to the newly selected input device");
      }

      voiceLog.info(
        "MIC",
        `Active handles: ${handles.length} — initializing device`,
      );
      initializeDevice(currentDeviceId);
      return;
    }

    if (!micStreamRef.current) return;

    // If the app is hidden/alt-tabbed and React stops rendering a subtree,
    // consumers may briefly remove every microphone handle. Do not stop the
    // OS microphone in that state; voice chat must continue in the background.
    if (document.hidden) {
      voiceLog.info(
        "MIC",
        "No active handles while document is hidden — keeping microphone alive",
      );

      const onVisible = () => {
        if (document.hidden) return;
        document.removeEventListener("visibilitychange", onVisible);

        if (handles.length === 0) {
          clearPendingMicRelease();

          releaseMicTimerRef.current = setTimeout(() => {
            if (handles.length === 0 && !document.hidden) {
              stopMicStream(
                "No active handles after returning to foreground — releasing microphone",
              );
            }
          }, MIC_RELEASE_GRACE_MS);
        }
      };

      document.addEventListener("visibilitychange", onVisible);
      return () => {
        document.removeEventListener("visibilitychange", onVisible);
      };
    }

    clearPendingMicRelease();

    releaseMicTimerRef.current = setTimeout(() => {
      if (handles.length === 0 && !document.hidden) {
        stopMicStream("No active handles — releasing microphone");
      }
    }, MIC_RELEASE_GRACE_MS);

    return () => {
      clearPendingMicRelease();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    handles.length,
    currentDeviceId,
    micRecoveryTick,
    activateAudioContext,
    audioContext,
    clearPendingMicRelease,
    stopMicStream,
  ]);

  useEffect(() => {
    if (!micStream || handles.length === 0) return;

    const tracks = micStream.getAudioTracks();
    if (tracks.length === 0) return;

    const checkInterval = setInterval(() => {
      const currentTracks = micStream.getAudioTracks();
      const hasLiveTracks =
        currentTracks.length > 0 &&
        currentTracks.some((track) => track.readyState === "live");

      if (!hasLiveTracks && handles.length > 0) {
        voiceLog.warn(
          "MIC",
          "Microphone tracks are no longer live — reinitializing",
        );
        setMicStream(undefined);
        micStreamRef.current = undefined;
        setMicRecoveryTick((value) => value + 1);
      }

      if (audioContext?.state === "suspended" && handles.length > 0) {
        audioContext.resume().catch(() => {});
      }
    }, 1000);

    return () => {
      clearInterval(checkInterval);
    };
  }, [micStream, handles.length, audioContext]);

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
    getGateLevel,
    isTransmitting,
    isPttActive,
    micUnavailable,
  };
}

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
    noiseGateWorklet: undefined,
    rnnoiseNode: undefined,
  },
  audioContext: undefined,
  addHandle: () => {},
  removeHandle: () => {},
  isLoaded: false,
  getDevices: async () => {},
  getVisualizerData: () => null,
  // Null until the gate worklet exists, so callers fall back to their own
  // measurement rather than treating "not transmitting" as fact.
  getGateLevel: () => null,
  isTransmitting: null,
  isPttActive: { current: false },
  micUnavailable: null,
};

const singletonMicrophone = singletonHook(init, useCreateMicrophoneHook);

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
