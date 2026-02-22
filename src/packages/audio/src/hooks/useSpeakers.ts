import { useEffect, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { useSharedAudioContext } from "./useAudioContext";

interface Speakers {
  devices: MediaDeviceInfo[];
  audioContext?: AudioContext;
}

function useSpeakersHook(): Speakers {
  const audioContext = useSharedAudioContext();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((d) => setDevices(d.filter((dev) => dev.kind === "audiooutput")))
      .catch(() => {});
  }, []);

  return { devices, audioContext };
}

const init: Speakers = { devices: [], audioContext: undefined };

const SpeakerHook = singletonHook(init, useSpeakersHook);

export const useSpeakers = () => SpeakerHook();
