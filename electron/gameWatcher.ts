/**
 * Automatic mode: every running program checked against the shipped games list.
 * Reads the whole process list, and passes on only the names of listed games.
 */

import type { GameIndex } from "./gameList";

export interface GameWatcher {
  start(): void;
  stop(): void;
  /** Games hidden in settings are never reported, and hiding one that's showing clears it. */
  setHidden(names: readonly string[]): void;
  /** What matched at the last poll, hidden ones left out. */
  current(): string[];
  /** Every listed game seen since start, hidden or not, for the list somebody hides from. */
  seen(): string[];
}

interface GameWatcherOptions {
  index: GameIndex;
  /** Called only when the answer changes. */
  onChange: (names: string[]) => void;
  /** Ten seconds in the app, the same as watched programs. */
  intervalMs: number;
  /** `listRunningExecutables` in the app. A test passes its own. */
  list: () => Promise<string[]>;
}

export function createGameWatcher({
  index,
  onChange,
  intervalMs,
  list,
}: GameWatcherOptions): GameWatcher {
  let hidden = new Set<string>();
  let matched: string[] = [];
  let reported: string[] = [];
  const seenNames = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let polling = false;

  const announce = () => {
    const next = matched.filter((name) => !hidden.has(name));
    if (next.length === reported.length && next.every((name, i) => name === reported[i])) return;
    reported = next;
    onChange([...reported]);
  };

  async function poll(): Promise<void> {
    if (polling || !timer) return;
    polling = true;
    try {
      const running = await list();
      if (!timer) return;
      matched = index.matchRunning(running);
      for (const name of matched) seenNames.add(name);
      announce();
    } finally {
      polling = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void poll(), intervalMs);
      timer.unref?.();
      void poll();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      matched = [];
      announce();
    },
    setHidden(names) {
      hidden = new Set(names);
      announce();
    },
    current: () => [...reported],
    seen: () => [...seenNames].sort((a, b) => a.localeCompare(b)),
  };
}
