import { useCallback, useEffect, useState } from "react";

import { getElectronAPI, isElectron, type PresenceHelperStatus } from "../../../../lib/electron";

const EMPTY: PresenceHelperStatus = { offered: false, enabledAt: null, registered: false, needsApproval: false, error: null };

/** The switch for gryt-helper, which starts at login (GRYT-1605). */
export function usePresenceHelper() {
  const api = isElectron() ? getElectronAPI() : null;
  const [status, setStatus] = useState<PresenceHelperStatus>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api?.getPresenceHelper?.().then((next) => next && setStatus(next));
  }, [api]);

  const set = useCallback(
    async (on: boolean) => {
      setBusy(true);
      try {
        const next = await api?.setPresenceHelper?.(on);
        if (next) setStatus(next);
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  return { ...status, busy, set };
}
