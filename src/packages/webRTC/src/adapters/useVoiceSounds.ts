import { useCallback } from "react";

import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import peerJoinMp3 from "@/audio/src/assets/peer-join.mp3";
import peerLeaveMp3 from "@/audio/src/assets/peer-leave.mp3";
import voiceFailedMp3 from "@/audio/src/assets/voice-failed.mp3";
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

  // Rides on the disconnect setting, so turning leave sounds off silences this too.
  const playFailed = useCallback(() => {
    if (!disconnectSoundEnabled) return;
    playNotificationSound(voiceFailedMp3, disconnectSoundVolume);
  }, [disconnectSoundEnabled, disconnectSoundVolume]);

  // Someone else coming and going rides on your own connect and disconnect settings.
  const playPeerJoin = useCallback(() => {
    if (connectSoundEnabled) playNotificationSound(peerJoinMp3, connectSoundVolume);
  }, [connectSoundEnabled, connectSoundVolume]);
  const playPeerLeave = useCallback(() => {
    if (disconnectSoundEnabled) playNotificationSound(peerLeaveMp3, disconnectSoundVolume);
  }, [disconnectSoundEnabled, disconnectSoundVolume]);

  return { playConnect, playDisconnect, playFailed, playPeerJoin, playPeerLeave };
}
