/* Whether you're at this desktop, for the server's push decision (GRYT-1699). Away, it wakes your
   phone instead; here, it doesn't, so a message you're reading doesn't buzz in your pocket too. */

/** The window out of focus or hidden this long counts as away. */
export const UNFOCUSED_MS = 60_000;
/** No mouse or keyboard this long counts as away, even with the window in front. */
export const IDLE_MS = 5 * 60_000;
const TICK_MS = 15_000;

export interface Activity {
  focused: boolean;
  /** When focus was lost, or null while focused. */
  blurredAt: number | null;
  lastInput: number;
}

export function isAway(activity: Activity, now: number): boolean {
  if (now - activity.lastInput >= IDLE_MS) return true;
  return !activity.focused && activity.blurredAt !== null && now - activity.blurredAt >= UNFOCUSED_MS;
}

export interface AwayDeps {
  now: () => number;
  /** Whether the window is in front right now. */
  focused: () => boolean;
  /** Calls back on focus changes, and returns a function that stops. */
  onFocusChange: (callback: (focused: boolean) => void) => () => void;
  /** Calls back on any mouse, key or touch input, and returns a function that stops. */
  onInput: (callback: () => void) => () => void;
  every: (ms: number, callback: () => void) => () => void;
}

/** Calls `onChange` with the starting state and again whenever it flips. */
export function watchAway(onChange: (away: boolean) => void, deps: AwayDeps): () => void {
  const start = deps.now();
  const focused = deps.focused();
  const activity: Activity = { focused, blurredAt: focused ? null : start, lastInput: start };
  let away = isAway(activity, start);
  onChange(away);

  const check = () => {
    const next = isAway(activity, deps.now());
    if (next !== away) onChange((away = next));
  };
  const stops = [
    deps.onFocusChange((nowFocused) => {
      if (nowFocused === activity.focused) return;
      activity.focused = nowFocused;
      activity.blurredAt = nowFocused ? null : deps.now();
      // Coming back to the window is a sign of life on its own.
      if (nowFocused) activity.lastInput = deps.now();
      check();
    }),
    deps.onInput(() => {
      activity.lastInput = deps.now();
      if (away) check();
    }),
    deps.every(TICK_MS, check),
  ];
  return () => stops.forEach((stop) => stop());
}

/** The real window, the page's visibility, and Electron's own focus events where there are any. */
export function browserAwayDeps(electronFocus?: (callback: (focused: boolean) => void) => () => void): AwayDeps {
  const focusedNow = () => document.visibilityState === "visible" && document.hasFocus();
  return {
    now: Date.now,
    focused: focusedNow,
    onFocusChange: (callback) => {
      const update = () => callback(focusedNow());
      window.addEventListener("focus", update);
      window.addEventListener("blur", update);
      document.addEventListener("visibilitychange", update);
      const stopElectron = electronFocus?.((f) => callback(f && document.visibilityState === "visible"));
      return () => {
        window.removeEventListener("focus", update);
        window.removeEventListener("blur", update);
        document.removeEventListener("visibilitychange", update);
        stopElectron?.();
      };
    },
    onInput: (callback) => {
      // Passive and coarse: only the time of the last one matters.
      const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
      for (const e of events) window.addEventListener(e, callback, { passive: true });
      return () => events.forEach((e) => window.removeEventListener(e, callback));
    },
    every: (ms, callback) => {
      const id = setInterval(callback, ms);
      return () => clearInterval(id);
    },
  };
}
