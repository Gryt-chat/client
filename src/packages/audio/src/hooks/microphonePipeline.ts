import { useCallback, useEffect, useRef } from "react";

import { sliderToOutputGain } from "@/lib/audioVolume";
import { voiceLog } from "@/webRTC/src/hooks/voiceLogger";

import { MicrophoneBufferType } from "../types/Microphone";

export interface CreateMicrophoneBufferParams {
  audioContext: AudioContext;
  micStream: MediaStream | undefined;
  rnnoiseNode: AudioWorkletNode | null;
  eSportsModeEnabled: boolean;
  autoGainEnabled: boolean;
  compressorEnabled: boolean;
}

export function createMicrophoneBuffer({
  audioContext,
  micStream,
  rnnoiseNode,
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

  volumeGain.gain.value = 2.0;
  rawOutput.gain.value = 1;
  noiseGate.gain.value = 1;
  muteGain.gain.value = 1;

  let processingChain: AudioNode = input;

  // Step 1: Volume control
  processingChain.connect(volumeGain);
  processingChain = volumeGain;

  // Step 2: Raw analyser + raw output for noise gate monitoring
  processingChain.connect(analyser);
  processingChain.connect(rawOutput);

  // Step 3: RNNoise noise reduction via AudioWorklet
  if (rnnoiseNode) {
    try {
      processingChain.connect(rnnoiseNode);
      processingChain = rnnoiseNode;
    } catch (error) {
      console.error('Failed to connect RNNoise AudioWorklet node:', error);
    }
  }

  // Step 4: True AGC — analyser measures input RMS, gain node is adjusted
  // dynamically in usePipelineControls to hit a target dB level
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

  // Step 5: Compressor for taming dynamic peaks (params controlled at runtime)
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

  // Step 6: Noise gate
  processingChain.connect(noiseGate);

  // Step 7: Noise gate -> mute
  noiseGate.connect(muteGain);

  // Step 8: Mute -> final analyser -> output
  muteGain.connect(finalAnalyser);
  finalAnalyser.connect(outputDestination);

  return {
    input,
    output,
    rawOutput,
    analyser,
    finalAnalyser,
    mediaStream: micStream || new MediaStream(),
    processedStream: outputDestination.stream,
    muteGain,
    volumeGain,
    noiseGate,
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
  loopbackEnabled: boolean;
  inputMode: "voice_activity" | "push_to_talk";
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
  loopbackEnabled,
  inputMode,
  autoGainEnabled,
  autoGainTargetDb,
  compressorAmount,
}: PipelineControlParams) {
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const loopbackGainRef = useRef<GainNode | null>(null);
  const agcGainValueRef = useRef(1.0);

  // Connect microphone stream to processing chain - with proper cleanup
  useEffect(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
      sourceNodeRef.current = null;
    }

    if (micStream && audioContext && microphoneBuffer.input) {
      const tracks = micStream.getAudioTracks();
      voiceLog.step("LOOPBACK", 1, "Connecting mic source → pipeline input", {
        contextState: audioContext.state,
        trackCount: tracks.length,
        tracks: tracks.map(t => ({ id: t.id, label: t.label, readyState: t.readyState, enabled: t.enabled })),
        hasInput: !!microphoneBuffer.input,
      });
      try {
        const sourceNode = audioContext.createMediaStreamSource(micStream);
        sourceNode.connect(microphoneBuffer.input);
        sourceNodeRef.current = sourceNode;
        voiceLog.ok("LOOPBACK", 1, "Mic source connected to pipeline");
      } catch (error) {
        voiceLog.fail("LOOPBACK", 1, "Failed to connect mic source to pipeline", error);
      }
    } else {
      voiceLog.warn("LOOPBACK", "Source connection skipped — missing prerequisites", {
        hasMicStream: !!micStream,
        hasAudioContext: !!audioContext,
        contextState: audioContext?.state,
        hasInput: !!microphoneBuffer.input,
      });
    }

    return () => {
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.disconnect();
        } catch (error) {
          // Ignore disconnect errors
        }
        sourceNodeRef.current = null;
      }
    };
  }, [micStream, audioContext, microphoneBuffer.input]);

  // Volume control updates
  useEffect(() => {
    if (microphoneBuffer.volumeGain) {
      microphoneBuffer.volumeGain.gain.setValueAtTime(sliderToOutputGain(micVolume), audioContext?.currentTime || 0);
    }
  }, [micVolume, microphoneBuffer.volumeGain, audioContext]);

  // Mute control updates -- in PTT mode, muteGain is managed by usePushToTalk
  useEffect(() => {
    if (!microphoneBuffer.muteGain) return;
    if (inputMode === "push_to_talk") {
      voiceLog.info("LOOPBACK", "Mute gain → 0 (PTT mode, managed by PTT hook)");
      microphoneBuffer.muteGain.gain.setValueAtTime(0, audioContext?.currentTime || 0);
      return;
    }
    const gainValue = isMuted ? 0 : 1;
    voiceLog.info("LOOPBACK", `Mute gain → ${gainValue} (isMuted=${isMuted}, inputMode=${inputMode})`);
    microphoneBuffer.muteGain.gain.setValueAtTime(gainValue, audioContext?.currentTime || 0);
  }, [isMuted, microphoneBuffer.muteGain, audioContext, inputMode]);

  // Noise gate control -- skipped entirely in push-to-talk mode
  useEffect(() => {
    if (inputMode === "push_to_talk") return;
    if (!microphoneBuffer.analyser || !microphoneBuffer.noiseGate || !audioContext) {
      return;
    }

    let animationFrame: number;
    const bufferLength = microphoneBuffer.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const checkNoiseGate = () => {
      microphoneBuffer.analyser!.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);
      const volume = (rms / 255) * 100;

      const shouldGate = volume < noiseGate;
      const gateValue = shouldGate ? 0 : 1;

      const rampTime = 0.01;
      microphoneBuffer.noiseGate!.gain.cancelScheduledValues(audioContext!.currentTime);
      microphoneBuffer.noiseGate!.gain.setValueAtTime(
        microphoneBuffer.noiseGate!.gain.value,
        audioContext!.currentTime
      );
      microphoneBuffer.noiseGate!.gain.linearRampToValueAtTime(
        gateValue,
        audioContext!.currentTime + rampTime
      );

      animationFrame = requestAnimationFrame(checkNoiseGate);
    };

    checkNoiseGate();

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [microphoneBuffer.analyser, microphoneBuffer.noiseGate, audioContext, noiseGate, inputMode]);

  // AGC feedback loop — measures input RMS and adjusts gain to hit targetDb
  useEffect(() => {
    if (!autoGainEnabled || !microphoneBuffer.agcAnalyser || !microphoneBuffer.agcGain || !audioContext) {
      return;
    }

    const analyserNode = microphoneBuffer.agcAnalyser;
    const gainNode = microphoneBuffer.agcGain;
    const dataArray = new Float32Array(analyserNode.fftSize);

    const targetLinear = Math.pow(10, autoGainTargetDb / 20);
    const silenceFloor = 0.001; // ~ -60 dBFS
    const minGain = 0.1;       // -20 dB
    const maxGain = 31.6;      // +30 dB
    const smoothUp = 0.02;     // slow attack to avoid pumping
    const smoothDown = 0.08;   // faster release to catch sudden loudness

    let rafId: number;

    const adjust = () => {
      analyserNode.getFloatTimeDomainData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);

      if (rms > silenceFloor) {
        const desiredGain = targetLinear / rms;
        const clamped = Math.max(minGain, Math.min(maxGain, desiredGain));
        const alpha = clamped > agcGainValueRef.current ? smoothUp : smoothDown;
        agcGainValueRef.current += (clamped - agcGainValueRef.current) * alpha;

        gainNode.gain.setTargetAtTime(
          agcGainValueRef.current,
          audioContext.currentTime,
          0.05
        );
      }

      rafId = requestAnimationFrame(adjust);
    };

    adjust();

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [autoGainEnabled, microphoneBuffer.agcAnalyser, microphoneBuffer.agcGain, audioContext, autoGainTargetDb]);

  // Compressor amount — maps 0-100 to threshold/ratio/knee at runtime
  useEffect(() => {
    if (!microphoneBuffer.compressor) return;
    const t = compressorAmount / 100;
    const threshold = -10 + t * (-40 - -10); // -10 → -40
    const ratio = 1 + t * (20 - 1);          // 1 → 20
    const knee = 40 + t * (5 - 40);          // 40 → 5

    const now = audioContext?.currentTime || 0;
    microphoneBuffer.compressor.threshold.setValueAtTime(threshold, now);
    microphoneBuffer.compressor.ratio.setValueAtTime(ratio, now);
    microphoneBuffer.compressor.knee.setValueAtTime(knee, now);
  }, [microphoneBuffer.compressor, compressorAmount, audioContext]);

  // Loopback (monitoring) control - uses FINAL processed audio so users hear what others hear
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

    if (microphoneBuffer.finalAnalyser && audioContext) {
      try {
        if (loopbackGainRef.current) {
          voiceLog.info("LOOPBACK", "Disconnecting previous loopback gain node");
          loopbackGainRef.current.disconnect();
          loopbackGainRef.current = null;
        }

        const loopbackGain = audioContext.createGain();
        loopbackGain.gain.value = 1;
        loopbackGainRef.current = loopbackGain;

        microphoneBuffer.finalAnalyser.connect(loopbackGain);
        voiceLog.info("LOOPBACK", "Connected finalAnalyser → loopbackGain");

        if (loopbackEnabled) {
          loopbackGain.connect(audioContext.destination);
          voiceLog.ok("LOOPBACK", 3, "Loopback ACTIVE — connected to speakers", {
            contextState: audioContext.state,
            destinationChannels: audioContext.destination.maxChannelCount,
            sampleRate: audioContext.sampleRate,
          });
        } else {
          voiceLog.info("LOOPBACK", "Loopback disabled — NOT connected to speakers");
        }
      } catch (error) {
        voiceLog.fail("LOOPBACK", 3, "Loopback control error", error);
      }
    } else {
      voiceLog.warn("LOOPBACK", "Loopback effect skipped — missing finalAnalyser or audioContext", {
        hasFinalAnalyser: !!microphoneBuffer.finalAnalyser,
        hasAudioContext: !!audioContext,
      });
    }

    return () => {
      if (loopbackGainRef.current) {
        try {
          loopbackGainRef.current.disconnect();
        } catch (error) {
          // Ignore disconnect errors
        }
        loopbackGainRef.current = null;
      }
    };
  }, [loopbackEnabled, microphoneBuffer.finalAnalyser, audioContext, microphoneBuffer.muteGain, microphoneBuffer.noiseGate, microphoneBuffer.volumeGain]);

  // Visualizer data extraction - returns FINAL processed audio
  const getVisualizerData = useCallback((): Uint8Array | null => {
    if (!microphoneBuffer.finalAnalyser) {
      return null;
    }

    const bufferLength = microphoneBuffer.finalAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    microphoneBuffer.finalAnalyser.getByteFrequencyData(dataArray);
    return dataArray;
  }, [microphoneBuffer.finalAnalyser]);

  return { getVisualizerData };
}
