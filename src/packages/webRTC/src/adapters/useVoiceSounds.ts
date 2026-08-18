import { useCallback } from "react";

import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import { playNotificationSound } from "@/lib/notificationSound";
import { useSettings } from "@/settings";

/**
 * The connect and disconnect sounds, which are the client's again.
 *
 * `@gryt/voice` used to take a file and a volume and play them. It no longer
 * plays anything: it reports, and this decides. That is why the assets, the
 * volumes and the enabled flags all live here, where the settings already are.
 *
 * A caller that wants a sound calls one of these. A caller that does not, does
 * not — which replaces the `playSound` argument `disconnect()` used to take.
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
