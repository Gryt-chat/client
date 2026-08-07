import { useEffect, useState } from "react";

import { getElectronAPI, isElectron } from "../../../../lib/electron";

/**
 * The amber a beta build wears.
 *
 * Deliberately far from the brand violet rather than a tint of it — the point
 * is that you can tell which build you are looking at without reading anything.
 * Kept in step by hand with the same value in electron/splash.html, which
 * cannot import from here.
 */
export const BETA_ACCENT = "#f2a33c";

/**
 * Is the build that is currently running a beta?
 *
 * The version decides, not the channel preference. Someone can be subscribed to
 * beta while still running the stable build they last installed, and the mark
 * should describe what is actually open. Non-Electron builds have no version to
 * ask for and are never marked.
 */
export function useIsBetaBuild(): boolean {
  const [isBeta, setIsBeta] = useState(false);

  useEffect(() => {
    if (!isElectron()) return;
    let cancelled = false;
    getElectronAPI()
      ?.getAppVersion()
      .then((v) => {
        if (!cancelled) setIsBeta(/-beta/i.test(v));
      })
      .catch(() => {
        /* No version, no mark. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return isBeta;
}

