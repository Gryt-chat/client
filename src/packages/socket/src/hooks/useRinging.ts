import { useEffect } from "react";

import { showDesktopNotification } from "@/lib/desktopNotification";
import { playLoopingSound } from "@/lib/notificationSound";
import { resolveSound, RINGTONES } from "@/lib/soundPresets";
import { useSettings } from "@/settings";

/**
 * While somebody is calling: the ringtone on repeat, the taskbar flashing, and an OS
 * notification when the app isn't in front (GRYT-2010). All of it stops with the ring.
 */
export function useRinging(call: { conversationId: string; title: string; host: string } | null): void {
  const { ringtoneEnabled, ringtoneVolume, customRingtoneFile, desktopNotificationsEnabled } = useSettings();
  const conversationId = call?.conversationId ?? null;

  useEffect(() => {
    if (!call) return;
    const ring = ringtoneEnabled ? playLoopingSound(resolveSound(customRingtoneFile, RINGTONES), ringtoneVolume) : null;
    window.electronAPI?.flashFrame?.(true);
    if (desktopNotificationsEnabled && !document.hasFocus()) {
      showDesktopNotification(call.title, "Calling you", { host: call.host, channelId: call.conversationId });
    }
    return () => {
      ring?.stop();
      window.electronAPI?.flashFrame?.(false);
    };
    // One ring per conversation: a re-render with the same call must not restart the sound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);
}
