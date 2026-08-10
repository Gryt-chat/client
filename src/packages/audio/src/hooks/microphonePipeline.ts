import { useCallback, useEffect, useRef } from "react";

import { sliderToOutputGain } from "@/lib/audioVolume";
import { voiceLog } from "@/webRTC/src/hooks/voiceLogger";

import { MicrophoneBufferType } from "../types/Microphone";

export interface CreateMicrophoneBufferParams {
  audioContext: AudioContext;
  micStream: MediaStream | undefined;
  rnnoiseNode: AudioWorkletNode | null;
  /**
   * Gate running on the audio thread. When null (worklet registration failed)
   * the pipeline falls back to the GainNode driven from the main thread, which
   * cannot gate while the window is hidden — see the noise gate effect below.
   */
  noiseGateNode: AudioWorkletNode | null;
  eSportsModeEnabled: boolean;
  autoGainEnabled: boolean;
  compressorEnabled: boolean;
}

export function createMicrophoneBuffer({
  audioContext,
  micStream,
  rnnoiseNode,
  noiseGateNode,
  eSportsModeEnabled,
  autoGainEnabled,
  compressorEnabled,
}: CreateMicrophoneBufferParams): MicrophoneBufferType {
  const input = audioContext.createGain();
  const volumeGain = audioContext.createGain();
  const rawOutput = audioContext.createGain();
  const noiseGate = audioContext.createGain();
  const muteGain = audioContext.createGain();
  const analyser = audioContext.createAnalyser();
  const finalAnalyser = audioContext.createAnalyser();
  const outputDestination = audioContext.createMediaStreamDestination();
  const output = audioContext.createMediaStreamSource(outputDestination.stream);

  const fftSize = eSportsModeEnabled ? 128 : 256;
  const smoothing = eSportsModeEnabled ? 0.3 : 0.8;

  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = smoothing;
  finalAnalyser.fftSize = fftSize;
  finalAnalyser.smoothingTimeConstant = smoothing;

  // Everything the pipeline does to your voice, taken before the mute. The
  // microphone test plays this rather than finalAnalyser, which sits after
  // muteGain and is therefore silent whenever you are muted — including the
  // auto-mute the test itself applies when you are in a channel.
  const monitorTap = audioContext.createGain();
  monitorTap.gain.value = 1;

  volumeGain.gain.value = 2.0;
  rawOutput.gain.value = 1;
  noiseGate.gain.value = 1;
  muteGain.gain.value = 1;

  let processingChain: AudioNode = input;

  processingChain.connect(volumeGain);
  processingChain = volumeGain;

  processingChain.connect(analyser);
  processingChain.connect(rawOutput);

  if (rnnoiseNode) {
    try {
      processingChain.connect(rnnoiseNode);
      processingChain = rnnoiseNode;
    } catch (error) {
      console.error("Failed to connect RNNoise AudioWorklet node:", error);
    }
  }

  let agcAnalyser: AnalyserNode | undefined;
  let agcGain: GainNode | undefined;

  if (autoGainEnabled) {
    agcAnalyser = audioContext.createAnalyser();
    agcAnalyser.fftSize = 2048;
    agcAnalyser.smoothingTimeConstant = 0;

    agcGain = audioContext.createGain();
    agcGain.gain.value = 1.0;

    processingChain.connect(agcAnalyser);
    agcAnalyser.connect(agcGain);
    processingChain = agcGain;
  }

  let compressor: DynamicsCompressorNode | undefined;

  if (compressorEnabled) {
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 20;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    processingChain.connect(compressor);
    processingChain = compressor;
  }

  if (noiseGateNode) {
    // Input 0 carries the signal being gated. Input 1 is a tap taken before
    // RNNoise/AGC/compressor, because that is where the threshold was always
    // measured — gating post-chain audio against a post-chain level would
    // change what the user's threshold percentage means.
    processingChain.connect(noiseGateNode, 0, 0);
    volumeGain.connect(noiseGateNode, 0, 1);
    noiseGateNode.connect(monitorTap);
  } else {
    processingChain.connect(noiseGate);
    noiseGate.connect(monitorTap);
  }

  monitorTap.connect(muteGain);
  muteGain.connect(finalAnalyser);
  finalAnalyser.connect(outputDestination);

  return {
    input,
    output,
    rawOutput,
    analyser,
    finalAnalyser,
    monitorTap,
    mediaStream: micStream || new MediaStream(),
    processedStream: outputDestination.stream,
    muteGain,
    volumeGain,
    noiseGate,
    noiseGateWorklet: noiseGateNode ?? undefined,
    rnnoiseNode: rnnoiseNode ?? undefined,
    agcAnalyser,
    agcGain,
    compressor,
  };
}

export interface PipelineControlParams {
  microphoneBuffer: MicrophoneBufferType;
  audioContext: AudioContext | undefined;
  micStream: MediaStream | undefined;
  micVolume: number;
  isMuted: boolean;
  noiseGate: number;
  noiseGateRelease: number;
  loopbackEnabled: boolean;
  inputMode: "voice_activity" | "push_to_talk";
  eSportsModeEnabled: boolean;
  autoGainEnabled: boolean;
  autoGainTargetDb: number;
  compressorAmount: number;
}

export function usePipelineControls({
  microphoneBuffer,
  audioContext,
  micStream,
  micVolume,
  isMuted,
  noiseGate,
  noiseGateRelease,
  loopbackEnabled,
  inputMode,
  eSportsModeEnabled,
  autoGainEnabled,
  autoGainTargetDb,
  compressorAmount,
}: PipelineControlParams) {
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const loopbackGainRef = useRef<GainNode | null>(null);
  const agcGainValueRef = useRef(1.0);

  useEffect(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore disconnect errors.
      }

      sourceNodeRef.current = null;
    }

    if (micStream && audioContext && microphoneBuffer.input) {
      const tracks = micStream.getAudioTracks();

      voiceLog.step("LOOPBACK", 1, "Connecting mic source → pipeline input", {
        contextState: audioContext.state,
        trackCount: tracks.length,
        tracks: tracks.map((track) => ({
          id: track.id,
          label: track.label,
          readyState: track.readyState,
          enabled: track.enabled,
        })),
        hasInput: !!microphoneBuffer.input,
      });

      try {
        const sourceNode = audioContext.createMediaStreamSource(micStream);
        sourceNode.connect(microphoneBuffer.input);
        sourceNodeRef.current = sourceNode;

        voiceLog.ok("LOOPBACK", 1, "Mic source connected to pipeline");
      } catch (error) {
        voiceLog.fail(
          "LOOPBACK",
          1,
          "Failed to connect mic source to pipeline",
          error,
        );
      }
    } else {
      voiceLog.warn(
        "LOOPBACK",
        "Source connection skipped — missing prerequisites",
        {
          hasMicStream: !!micStream,
          hasAudioContext: !!audioContext,
          contextState: audioContext?.state,
          hasInput: !!microphoneBuffer.input,
        },
      );
    }

    return () => {
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.disconnect();
        } catch {
          // Ignore disconnect errors.
        }

        sourceNodeRef.current = null;
      }
    };
  }, [micStream, audioContext, microphoneBuffer.input]);

  useEffect(() => {
    if (!microphoneBuffer.volumeGain) return;

    microphoneBuffer.volumeGain.gain.setValueAtTime(
      sliderToOutputGain(micVolume),
      audioContext?.currentTime || 0,
    );
  }, [micVolume, microphoneBuffer.volumeGain, audioContext]);

  useEffect(() => {
    if (!microphoneBuffer.muteGain) return;

    if (inputMode === "push_to_talk") {
      voiceLog.info(
        "LOOPBACK",
        "Mute gain → 0 (PTT mode, managed by PTT hook)",
      );

      microphoneBuffer.muteGain.gain.setValueAtTime(
        0,
        audioContext?.currentTime || 0,
      );

      return;
    }

    const gainValue = isMuted ? 0 : 1;

    voiceLog.info(
      "LOOPBACK",
      `Mute gain → ${gainValue} (isMuted=${isMuted}, inputMode=${inputMode})`,
    );

    microphoneBuffer.muteGain.gain.setValueAtTime(
      gainValue,
      audioContext?.currentTime || 0,
    );
  }, [isMuted, microphoneBuffer.muteGain, audioContext, inputMode]);

  /**
   * Noise gate control — audio thread.
   *
   * The gate itself lives in an AudioWorklet, so it keeps running when the
   * window is hidden. All this does is push the current settings into it.
   *
   * Threshold 0 disables gating, which is what push-to-talk wants: there the
   * gating is done by muteGain instead.
   */
  useEffect(() => {
    const gate = microphoneBuffer.noiseGateWorklet;
    if (!gate || !audioContext) return;

    const gating = inputMode !== "push_to_talk";

    gate.parameters.get("threshold")?.setValueAtTime(
      gating ? noiseGate : 0,
      audioContext.currentTime,
    );
    gate.parameters.get("release")?.setValueAtTime(
      noiseGateRelease,
      audioContext.currentTime,
    );
    gate.parameters
      .get("smoothing")
      ?.setValueAtTime(eSportsModeEnabled ? 0.3 : 0.8, audioContext.currentTime);
  }, [
    microphoneBuffer.noiseGateWorklet,
    audioContext,
    noiseGate,
    noiseGateRelease,
    inputMode,
    eSportsModeEnabled,
  ]);

  /**
   * Noise gate control — main thread fallback.
   *
   * Only runs when the worklet could not be registered. requestAnimationFrame
   * is throttled or paused when the window is hidden, so if the gate were
   * closed at that moment the outgoing stream could stay silent even though
   * the mic track is live. This forces the gate open while hidden, which means
   * recipients hear ungated audio — the behaviour GRYT-18 fixed by moving the
   * gate onto the audio thread. Kept only so a worklet failure degrades to
   * "gate stops working" rather than "microphone stops working".
   */
  useEffect(() => {
    if (microphoneBuffer.noiseGateWorklet) return;
    if (inputMode === "push_to_talk") return;

    if (
      !microphoneBuffer.analyser ||
      !microphoneBuffer.noiseGate ||
      !audioContext
    ) {
      return;
    }

    let animationFrame: number | null = null;
    let holdTimeout: ReturnType<typeof setTimeout> | null = null;
    let gateOpen = false;
    let stopped = false;

    const analyserNode = microphoneBuffer.analyser;
    const noiseGateNode = microphoneBuffer.noiseGate;
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const applyGain = (value: number) => {
      const rampTime = 0.01;
      const now = audioContext.currentTime;

      noiseGateNode.gain.cancelScheduledValues(now);
      noiseGateNode.gain.setValueAtTime(noiseGateNode.gain.value, now);
      noiseGateNode.gain.linearRampToValueAtTime(value, now + rampTime);
    };

    const clearHoldTimeout = () => {
      if (!holdTimeout) return;

      clearTimeout(holdTimeout);
      holdTimeout = null;
    };

    const forceGateOpenForBackgroundCapture = () => {
      clearHoldTimeout();
      gateOpen = true;
      applyGain(1);
    };

    const closeGate = () => {
      gateOpen = false;
      applyGain(0);
    };

    const scheduleNextFrame = () => {
      if (stopped || document.hidden) {
        animationFrame = null;
        return;
      }

      animationFrame = requestAnimationFrame(checkNoiseGate);
    };

    const checkNoiseGate = () => {
      if (stopped) {
        animationFrame = null;
        return;
      }

      if (document.hidden) {
        forceGateOpenForBackgroundCapture();
        animationFrame = null;
        return;
      }

      analyserNode.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }

      const rms = Math.sqrt(sum / bufferLength);
      const volume = (rms / 255) * 100;
      const aboveThreshold = volume >= noiseGate;

      if (aboveThreshold) {
        clearHoldTimeout();

        if (!gateOpen) {
          gateOpen = true;
          applyGain(1);
        }
      } else if (gateOpen && !holdTimeout) {
        holdTimeout = setTimeout(closeGate, noiseGateRelease);
      }

      scheduleNextFrame();
    };

    const startNoiseGateLoop = () => {
      if (stopped || document.hidden || animationFrame !== null) return;
      animationFrame = requestAnimationFrame(checkNoiseGate);
    };

    const stopNoiseGateLoop = () => {
      if (animationFrame === null) return;

      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopNoiseGateLoop();
        forceGateOpenForBackgroundCapture();
        return;
      }

      startNoiseGateLoop();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (document.hidden) {
      forceGateOpenForBackgroundCapture();
    } else {
      startNoiseGateLoop();
    }

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopNoiseGateLoop();
      clearHoldTimeout();
    };
  }, [
    microphoneBuffer.analyser,
    microphoneBuffer.noiseGate,
    microphoneBuffer.noiseGateWorklet,
    audioContext,
    noiseGate,
    noiseGateRelease,
    inputMode,
  ]);

  /**
   * AGC feedback loop.
   *
   * This intentionally uses setInterval instead of requestAnimationFrame so
   * gain continues to update when the renderer is hidden/unfocused.
   */
  useEffect(() => {
    if (
      !autoGainEnabled ||
      !microphoneBuffer.agcAnalyser ||
      !microphoneBuffer.agcGain ||
      !audioContext
    ) {
      return;
    }

    const analyserNode = microphoneBuffer.agcAnalyser;
    const gainNode = microphoneBuffer.agcGain;
    const dataArray = new Float32Array(analyserNode.fftSize);

    const targetLinear = Math.pow(10, autoGainTargetDb / 20);
    const silenceFloor = 0.001;
    const minGain = 0.1;
    const maxGain = 31.6;
    const smoothUp = 0.02;
    const smoothDown = 0.08;

    const adjust = () => {
      analyserNode.getFloatTimeDomainData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }

      const rms = Math.sqrt(sum / dataArray.length);

      if (rms <= silenceFloor) return;

      const desiredGain = targetLinear / rms;
      const clamped = Math.max(minGain, Math.min(maxGain, desiredGain));
      const alpha = clamped > agcGainValueRef.current ? smoothUp : smoothDown;

      agcGainValueRef.current += (clamped - agcGainValueRef.current) * alpha;

      gainNode.gain.setTargetAtTime(
        agcGainValueRef.current,
        audioContext.currentTime,
        0.05,
      );
    };

    adjust();

    const intervalId = window.setInterval(adjust, 50);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    autoGainEnabled,
    microphoneBuffer.agcAnalyser,
    microphoneBuffer.agcGain,
    audioContext,
    autoGainTargetDb,
  ]);

  useEffect(() => {
    if (!microphoneBuffer.compressor) return;

    const t = compressorAmount / 100;
    const threshold = -10 + t * (-40 - -10);
    const ratio = 1 + t * (20 - 1);
    const knee = 40 + t * (5 - 40);
    const now = audioContext?.currentTime || 0;

    microphoneBuffer.compressor.threshold.setValueAtTime(threshold, now);
    microphoneBuffer.compressor.ratio.setValueAtTime(ratio, now);
    microphoneBuffer.compressor.knee.setValueAtTime(knee, now);
  }, [microphoneBuffer.compressor, compressorAmount, audioContext]);

  useEffect(() => {
    voiceLog.step("LOOPBACK", 3, "Loopback effect running", {
      loopbackEnabled,
      hasFinalAnalyser: !!microphoneBuffer.finalAnalyser,
      hasAudioContext: !!audioContext,
      contextState: audioContext?.state,
      hasMuteGain: !!microphoneBuffer.muteGain,
      muteGainValue: microphoneBuffer.muteGain?.gain.value,
      hasNoiseGate: !!microphoneBuffer.noiseGate,
      noiseGateValue: microphoneBuffer.noiseGate?.gain.value,
      hasVolumeGain: !!microphoneBuffer.volumeGain,
      volumeGainValue: microphoneBuffer.volumeGain?.gain.value,
    });

    const monitorSource =
      microphoneBuffer.monitorTap ?? microphoneBuffer.finalAnalyser;

    if (monitorSource && audioContext) {
      try {
        if (loopbackGainRef.current) {
          voiceLog.info(
            "LOOPBACK",
            "Disconnecting previous loopback gain node",
          );
          loopbackGainRef.current.disconnect();
          loopbackGainRef.current = null;
        }

        const loopbackGain = audioContext.createGain();
        loopbackGain.gain.value = 1;
        loopbackGainRef.current = loopbackGain;

        monitorSource.connect(loopbackGain);
        voiceLog.info("LOOPBACK", "Connected monitor tap to loopbackGain");

        if (loopbackEnabled) {
          loopbackGain.connect(audioContext.destination);

          voiceLog.ok(
            "LOOPBACK",
            3,
            "Loopback ACTIVE — connected to speakers",
            {
              contextState: audioContext.state,
              destinationChannels: audioContext.destination.maxChannelCount,
              sampleRate: audioContext.sampleRate,
            },
          );
        } else {
          voiceLog.info(
            "LOOPBACK",
            "Loopback disabled — NOT connected to speakers",
          );
        }
      } catch (error) {
        voiceLog.fail("LOOPBACK", 3, "Loopback control error", error);
      }
    } else {
      voiceLog.warn(
        "LOOPBACK",
        "Loopback effect skipped — missing finalAnalyser or audioContext",
        {
          hasFinalAnalyser: !!microphoneBuffer.finalAnalyser,
          hasAudioContext: !!audioContext,
        },
      );
    }

    return () => {
      if (loopbackGainRef.current) {
        try {
          loopbackGainRef.current.disconnect();
        } catch {
          // Ignore disconnect errors.
        }

        loopbackGainRef.current = null;
      }
    };
  }, [
    loopbackEnabled,
    microphoneBuffer.monitorTap,
    microphoneBuffer.finalAnalyser,
    audioContext,
    microphoneBuffer.muteGain,
    microphoneBuffer.noiseGate,
    microphoneBuffer.volumeGain,
  ]);

  const getVisualizerData = useCallback((): Uint8Array | null => {
    if (!microphoneBuffer.finalAnalyser) return null;

    const bufferLength = microphoneBuffer.finalAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    microphoneBuffer.finalAnalyser.getByteFrequencyData(dataArray);

    return dataArray;
  }, [microphoneBuffer.finalAnalyser]);

  return { getVisualizerData };
}
