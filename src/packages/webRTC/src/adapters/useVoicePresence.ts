import { SFUConnectionState, useSFU } from "@gryt/voice";
import { useMemo } from "react";

import { useSettings } from "@/settings";

export type VoicePresence = {
  /* A call is in play: up, coming up, or trying to come back. Everything that
     tells somebody they are in a call reads this rather than isConnected. */
  inCall: boolean;
  /* The call is up and the microphone is open, so sound is leaving this
     machine. Muted or still connecting, it is not. */
  transmitting: boolean;
  live: boolean;
  muted: boolean;
  host: string;
  channelId: string;
  state: SFUConnectionState;
};

/* Not DISCONNECTED and not FAILED. FAILED is on its way to RECONNECTING or to
   DISCONNECTED within a tick, and neither is a call you are still in. */
const IN_CALL: ReadonlySet<SFUConnectionState> = new Set([
  SFUConnectionState.REQUESTING_ACCESS,
  SFUConnectionState.CONNECTING,
  SFUConnectionState.CONNECTED,
  SFUConnectionState.RECONNECTING,
]);

/* Where the call is, for everything that shows it. Built from the engine's state
   rather than one boolean, which took every voice mark dark together. GRYT-1136. */
export function useVoicePresence(): VoicePresence {
  const { connectionState, currentServerConnected, currentChannelConnected } = useSFU();
  const { isMuted, isServerMuted } = useSettings();

  const muted = isMuted || isServerMuted;

  return useMemo(() => {
    const live = connectionState === SFUConnectionState.CONNECTED;
    return {
      inCall: IN_CALL.has(connectionState),
      transmitting: live && !muted,
      live,
      muted,
      host: currentServerConnected,
      channelId: currentChannelConnected,
      state: connectionState,
    };
  }, [connectionState, currentServerConnected, currentChannelConnected, muted]);
}
