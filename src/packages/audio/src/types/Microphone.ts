import type { MutableRefObject } from "react";

export type MicrophoneBufferType = {
  input?: GainNode;
  output?: MediaStreamAudioSourceNode;
  rawOutput?: GainNode; // Raw audio output for monitoring (before noise gate)
  analyser?: AnalyserNode; // Raw audio analyser (for noise gate threshold detection)
  finalAnalyser?: AnalyserNode; // Final processed audio analyser (for UI and loopback)
  mediaStream?: MediaStream; // Raw microphone stream
  processedStream?: MediaStream; // Processed stream (after noise suppression, mute, etc.)
  monitorTap?: GainNode; // Fully processed audio, tapped before muteGain, for the microphone test
  monitorAnalyser?: AnalyserNode; // Level of that same tap, for the settings meter
  muteGain?: GainNode; // Dedicated gain node for muting
  volumeGain?: GainNode; // Dedicated gain node for volume control
  noiseGate?: GainNode; // Fallback gain node, used only when the gate worklet is unavailable
  noiseGateWorklet?: AudioWorkletNode; // Noise gate running on the audio thread
  rnnoiseNode?: AudioWorkletNode; // RNNoise noise reduction (AudioWorklet)
  agcAnalyser?: AnalyserNode; // AGC input level measurement
  agcGain?: GainNode; // AGC dynamic gain adjustment
  compressor?: DynamicsCompressorNode; // Separate compressor for peak taming
};

/**
 * Why the microphone could not be acquired. The three cases want different
 * advice, so they are kept apart rather than collapsed into a boolean:
 * "denied" is fixed in the OS or browser, "no-device" means nothing is plugged
 * in, and "failed" is everything else — a device that exists, was permitted,
 * and still would not open.
 */
export type MicrophoneUnavailableReason = "denied" | "no-device" | "failed";

export interface MicrophoneInterface {
  addHandle: (id: string) => void;
  removeHandle: (id: string) => void;
  /**
   * Set while there is no usable microphone, null once one is live. Joining a
   * voice channel deliberately still works in this state — listening without a
   * microphone is useful — so this is what lets the UI say so out loud instead
   * of looking healthy while nobody can hear you.
   */
  micUnavailable: MicrophoneUnavailableReason | null;
  microphoneBuffer: MicrophoneBufferType;
  isBrowserSupported: boolean | undefined;
  devices: InputDeviceInfo[];
  audioContext?: AudioContext;
  isLoaded: boolean;
  getDevices: () => Promise<void>;
  getVisualizerData: () => Uint8Array | null;
  /** Level the noise gate is deciding on, 0-100. Null if the gate worklet is unavailable. */
  getGateLevel: () => number | null;
  /** True while audio is actually leaving this client. Null if the gate worklet is unavailable. */
  isTransmitting: boolean | null;
  isPttActive: MutableRefObject<boolean>;
}
