import { useCallback, useEffect, useState } from "react";

import {
  getElectronAPI,
  isElectron,
  type RichPresenceApp,
  type RichPresenceStatus,
} from "../../../../lib/electron";

const EMPTY: RichPresenceStatus = {
  supported: false,
  consentedAt: null,
  state: "off",
  holder: null,
  hidden: [],
  seen: [],
  current: null,
};

/** The Rich Presence switch, who has the socket, and which apps are hidden (GRYT-1310). */
export function useRichPresence() {
  const api = isElectron() ? getElectronAPI() : null;
  const [status, setStatus] = useState<RichPresenceStatus>(EMPTY);

  const refresh = useCallback(async () => {
    const next = await api?.getRichPresence?.();
    if (next) setStatus(next);
  }, [api]);

  useEffect(() => {
    void refresh();
    // Turning it off elsewhere also drops the switch and the app list, so all of it is read again.
    const dropState = api?.onRichPresenceState?.(() => void refresh());
    // A new card can mean a new app to list, so the whole status is read again.
    const dropCard = api?.onRichPresenceChanged?.(() => void refresh());
    return () => {
      dropState?.();
      dropCard?.();
    };
  }, [api, refresh]);

  const setConsent = useCallback(
    async (allow: boolean) => {
      await api?.setRichPresenceConsent?.(allow);
      await refresh();
    },
    [api, refresh],
  );

  const setHidden = useCallback(
    async (apps: RichPresenceApp[]) => {
      await api?.setRichPresenceHidden?.(apps);
      await refresh();
    },
    [api, refresh],
  );

  return { ...status, setConsent, setHidden, refresh };
}
