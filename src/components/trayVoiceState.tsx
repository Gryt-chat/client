import { useEffect } from "react";

import { useSettings } from "@/settings";
import { useSockets } from "@/socket";
import { useVoicePresence } from "@/webRTC";


/**
 * Keeps the desktop tray in step with voice, and handles its menu commands.
 * Mounted at the app root: Controls only exists while a voice channel is open.
 */
export function TrayVoiceState() {
  const voice = useVoicePresence();
  const { serverDetailsList } = useSockets();
  const {
    isMuted,
    isDeafened,
    isServerMuted,
    isServerDeafened,
    setIsMuted,
    setIsDeafened,
  } = useSettings();

  // A server-side mute is still a mute here: the question is "is my microphone
  // reaching anyone", not "who switched it off".
  const muted = isMuted || isServerMuted;
  const deafened = isDeafened || isServerDeafened;
  const serverName =
    (voice.host && serverDetailsList[voice.host]?.server_info?.name) || null;

  useEffect(() => {
    window.electronAPI?.setVoiceState({
      // In a call the tray says so, including while it is coming up. The tray
      // is the only voice control left once the window is closed.
      inVoice: voice.inCall,
      muted,
      deafened,
      serverName,
    });
  }, [voice.inCall, muted, deafened, serverName]);

  useEffect(() => {
    return window.electronAPI?.onTrayVoiceCommand((command) => {
      if (command === "toggle-mute") {
        // Deafened implies muted, so un-muting from the tray while deafened puts
        // you in a call you cannot hear. The menu disables it; this is the guard.
        if (isDeafened) return;
        setIsMuted(!isMuted);
        return;
      }
      setIsDeafened(!isDeafened);
    });
  }, [isMuted, isDeafened, setIsMuted, setIsDeafened]);

  return null;
}
