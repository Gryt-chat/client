import { useCallback, useEffect, useState } from "react";

import { getElectronAPI, isElectron, type WatchedProgram } from "../../../../lib/electron";
import { useSettings } from "./useSettings";

/**
 * The programs somebody asked to be seen running, and which of them are. Kept in
 * the global store rather than per user: it describes this machine (GRYT-931).
 */
export interface WatchedProgramsState {
  /** Whether this build can look at all. False in the browser. */
  supported: boolean;
  watched: WatchedProgram[];
  /** The names, from the list, that are running now. */
  running: string[];
  setWatched: (programs: WatchedProgram[]) => Promise<void>;
  /** Everything open, for picking from. Fetched on demand, never held. */
  listRunning: () => Promise<string[]>;
  /** When reading the process list was allowed, null until it is. */
  consentedAt: string | null;
  /** Null clears the watch list too, which is what stops the watcher. */
  setConsent: (allow: boolean) => Promise<void>;
}

export function useWatchedPrograms(): WatchedProgramsState {
  const api = isElectron() ? getElectronAPI() : null;
  const supported = !!api?.getWatchedPrograms;

  const [watched, setWatchedState] = useState<WatchedProgram[]>([]);
  const [consentedAt, setConsentedAt] = useState<string | null>(null);

  /*
   * What is running comes from `useSettings` rather than a second subscription:
   * it already holds this, and two subscriptions are two places to be wrong.
   */
  const { playingNow: running } = useSettings();

  useEffect(() => {
    if (!api?.getWatchedPrograms) return;

    let cancelled = false;
    void api.getWatchedPrograms().then((list) => {
      if (!cancelled) setWatchedState(list);
    });
    void api.getProcessScanConsent?.().then((at) => {
      if (!cancelled) setConsentedAt(at);
    });

    return () => {
      cancelled = true;
    };
  }, [api]);

  const setWatched = useCallback(
    async (programs: WatchedProgram[]) => {
      if (!api?.setWatchedPrograms) return;
      /* The stored list rather than what was sent: the main process drops
         duplicates and anything past the cap. */
      setWatchedState(await api.setWatchedPrograms(programs));
    },
    [api],
  );

  const listRunning = useCallback(
    async () => (await api?.listRunningPrograms?.()) ?? [],
    [api],
  );

  const setConsent = useCallback(
    async (allow: boolean) => {
      const at = (await api?.setProcessScanConsent?.(allow)) ?? null;
      setConsentedAt(at);
      if (!at) setWatchedState([]);
    },
    [api],
  );

  return { supported, watched, running, setWatched, listRunning, consentedAt, setConsent };
}
