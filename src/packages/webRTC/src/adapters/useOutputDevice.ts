import { useSpeakers } from "@gryt/voice";
import { useEffect } from "react";

import { setNotificationOutputDevice } from "@/lib/notificationSound";
import { type AudioOutput, routeOutputDevice } from "@/lib/outputDevice";
import { useSettings } from "@/settings";

export function useOutputDevice(): void {
  const { outputDeviceID } = useSettings();
  const { audioContext } = useSpeakers();

  useEffect(() => {
    const apply = () => {
      setNotificationOutputDevice(outputDeviceID);
      if (audioContext) void routeOutputDevice(audioContext as AudioOutput, outputDeviceID);
    };
    apply();
    navigator.mediaDevices?.addEventListener("devicechange", apply);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", apply);
  }, [audioContext, outputDeviceID]);
}
