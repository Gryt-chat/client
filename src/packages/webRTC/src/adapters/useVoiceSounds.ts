import { useCallback } from "react";

import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import { playNotificationSound } from "@/lib/notificationSound";
import { useSettings } from "@/settings";

/**
 * The connect and disconnect sounds, which are the client's again. `@gryt/voice`
 * reports and this decides, so the assets and volumes live where the settings do.
 */
export function useVoiceSounds() {
  const {
    connectSoundEnabled,
    disconnectSoundEnabled,
    connectSoundVolume,
    disconnectSoundVolume,
    customConnectSoundFile,
    customDisconnectSoundFile,
  } = useSettings();

  const playConnect = useCallback(() => {
    if (!connectSoundEnabled) return;
    playNotificationSound(customConnectSoundFile || connectMp3, connectSoundVolume);
  }, [connectSoundEnabled, customConnectSoundFile, connectSoundVolume]);

  const playDisconnect = useCallback(() => {
    if (!disconnectSoundEnabled) return;
    playNotificationSound(
      customDisconnectSoundFile || disconnectMp3,
      disconnectSoundVolume,
    );
  }, [disconnectSoundEnabled, customDisconnectSoundFile, disconnectSoundVolume]);

  return { playConnect, playDisconnect };
}
