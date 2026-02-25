import { useCallback, useEffect, useMemo, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { useSharedAudioContext } from "./useAudioContext";

interface AudioContextWithSink extends AudioContext {
  setSinkId?(sinkId: string): Promise<void>;
}

interface Speakers {
  devices: MediaDeviceInfo[];
  audioContext?: AudioContext;
  remoteBusNode?: GainNode;
  getOutputDevices: () => void;
  applyOutputDevice: (deviceId: string) => void;
}

function useSpeakersHook(): Speakers {
  const audioContext = useSharedAudioContext();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const remoteBusNode = useMemo(() => {
    if (!audioContext) return undefined;
    const bus = audioContext.createGain();
    bus.gain.value = 1;
    bus.connect(audioContext.destination);
    return bus;
  }, [audioContext]);

  const getOutputDevices = useCallback(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((d) => setDevices(d.filter((dev) => dev.kind === "audiooutput")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getOutputDevices();
  }, [getOutputDevices]);

  const applyOutputDevice = useCallback((deviceId: string) => {
    if (!audioContext) return;
    const ctx = audioContext as AudioContextWithSink;
    if (typeof ctx.setSinkId === "function") {
      ctx.setSinkId(deviceId).catch(() => {});
    }
  }, [audioContext]);

  useEffect(() => {
    if (!audioContext) return;
    const saved = localStorage.getItem("outputDeviceID");
    if (saved) {
      applyOutputDevice(saved);
    }
  }, [audioContext, applyOutputDevice]);

  return { devices, audioContext, remoteBusNode, getOutputDevices, applyOutputDevice };
}

const init: Speakers = {
  devices: [],
  audioContext: undefined,
  remoteBusNode: undefined,
  getOutputDevices: () => {},
  applyOutputDevice: () => {},
};

const SpeakerHook = singletonHook(init, useSpeakersHook);

export const useSpeakers = () => SpeakerHook();
