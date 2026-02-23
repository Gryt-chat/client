import { useEffect, useMemo, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { useSharedAudioContext } from "./useAudioContext";

interface Speakers {
  devices: MediaDeviceInfo[];
  audioContext?: AudioContext;
  remoteBusNode?: GainNode;
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

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((d) => setDevices(d.filter((dev) => dev.kind === "audiooutput")))
      .catch(() => {});
  }, []);

  return { devices, audioContext, remoteBusNode };
}

const init: Speakers = { devices: [], audioContext: undefined, remoteBusNode: undefined };

const SpeakerHook = singletonHook(init, useSpeakersHook);

export const useSpeakers = () => SpeakerHook();
