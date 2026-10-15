import { useEffect, useState } from "react";

/** 4:07, or 1:02:07 past the hour. */
export function callClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Seconds since the call came up, counted here: the engine doesn't say when it started. */
export function useCallClock(live: boolean, key: string): number {
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setSince(live ? Date.now() : null), [live, key]);
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}
