import { useEffect } from "react";

export interface LinkStep {
  label: string;
  detail?: string;
  state: "done" | "busy" | "todo";
}

/** Marks each step done, busy or todo from where `at` is in the list. */
export function stepsAt(labels: { label: string; detail?: string }[], at: number): LinkStep[] {
  return labels.map((s, i) => {
    if (i < at) return { ...s, state: "done" };
    return { ...s, state: i === at ? "busy" : "todo" };
  });
}

/** Keeps the screen on while `active`, since a sleeping computer drops the link. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    const take = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then(
        (l) => (released ? void l.release() : (lock = l)),
        () => undefined,
      );
    };
    take();
    // The browser drops the lock when the window is hidden, so take it again on return.
    document.addEventListener("visibilitychange", take);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", take);
      void lock?.release();
    };
  }, [active]);
}
