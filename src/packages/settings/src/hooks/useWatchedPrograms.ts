import { useCallback, useEffect, useState } from "react";

import { getElectronAPI, isElectron, type WatchedProgram } from "../../../../lib/electron";
import { useSettings } from "./useSettings";

/**
 * The programs somebody asked to be seen running, and which of them are
 * (GRYT-931).
 *
 * Reads and writes through the preload. The list lives in the main process
 * because that is the only side that can look, and in the global store rather
 * than per user because it describes this machine — the same person on a laptop
 * and a desktop does not have the same things installed.
 *
 * Nothing here is available in a browser. `isElectron` is false there, every
 * call is absent, and the settings section that uses this says so rather than
 * rendering controls that cannot work.
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
}

export function useWatchedPrograms(): WatchedProgramsState {
  const api = isElectron() ? getElectronAPI() : null;
  const supported = !!api?.getWatchedPrograms;

  const [watched, setWatchedState] = useState<WatchedProgram[]>([]);

  /*
   * What is running comes from `useSettings` rather than from a second
   * subscription here.
   *
   * It already holds this — it has to, because the activity sent to servers is
   * a running program's name when there is one — and two subscriptions to the
   * same pushed event is two places to be wrong about the same fact. It also
   * means the "running" badge on this screen and the line other people see are
   * driven by one value rather than two that agree most of the time.
   */
  const { playingNow: running } = useSettings();

  useEffect(() => {
    if (!api?.getWatchedPrograms) return;

    let cancelled = false;
    void api.getWatchedPrograms().then((list) => {
      if (!cancelled) setWatchedState(list);
    });

    return () => {
      cancelled = true;
    };
  }, [api]);

  const setWatched = useCallback(
    async (programs: WatchedProgram[]) => {
      if (!api?.setWatchedPrograms) return;
      /* The stored list rather than what was sent: the main process drops
         duplicates and anything past the cap, and the screen should show what
         was kept rather than what was asked for. */
      setWatchedState(await api.setWatchedPrograms(programs));
    },
    [api],
  );

  const listRunning = useCallback(
    async () => (await api?.listRunningPrograms?.()) ?? [],
    [api],
  );

  return { supported, watched, running, setWatched, listRunning };
}
