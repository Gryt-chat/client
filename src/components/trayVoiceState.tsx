import { useSFU } from "@gryt/voice";
import { useEffect } from "react";

import { useSettings } from "@/settings";
import { useSockets } from "@/socket";


/**
 * Keeps the desktop tray in step with voice, and handles its menu commands.
 *
 * Renders nothing. It exists because the main process cannot see any of this
 * on its own — mute and deafen are renderer settings, and whether there is an
 * SFU connection at all is a renderer concern.
 *
 * Mounted at the app root rather than inside the voice UI on purpose. Controls
 * only exists while you are looking at a voice channel, so publishing from
 * there would leave the tray showing a call that ended the moment you
 * navigated away.
 */
export function TrayVoiceState() {
  const { isConnected, currentServerConnected } = useSFU();
  const { serverDetailsList } = useSockets();
  const {
    isMuted,
    isDeafened,
    isServerMuted,
    isServerDeafened,
    setIsMuted,
    setIsDeafened,
  } = useSettings();

  // A server-side mute is still a mute as far as the tray is concerned — the
  // question it answers is "is my microphone reaching anyone", not "who
  // switched it off".
  const muted = isMuted || isServerMuted;
  const deafened = isDeafened || isServerDeafened;
  const serverName =
    (currentServerConnected &&
      serverDetailsList[currentServerConnected]?.server_info?.name) ||
    null;

  useEffect(() => {
    window.electronAPI?.setVoiceState({
      inVoice: isConnected,
      muted,
      deafened,
      serverName,
    });
  }, [isConnected, muted, deafened, serverName]);

  useEffect(() => {
    return window.electronAPI?.onTrayVoiceCommand((command) => {
      if (command === "toggle-mute") {
        // Deafened implies muted, so un-muting from the tray while deafened
        // would put you back in a call you cannot hear. The menu disables the
        // item in that state; this is the guard for a command arriving anyway.
        if (isDeafened) return;
        setIsMuted(!isMuted);
        return;
      }
      setIsDeafened(!isDeafened);
    });
  }, [isMuted, isDeafened, setIsMuted, setIsDeafened]);

  return null;
}
