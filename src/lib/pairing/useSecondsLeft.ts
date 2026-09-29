import { useEffect, useState } from "react";

/** Whole seconds until `deadline`, ticking once a second. Zero once it has passed. */
export function useSecondsLeft(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline === null ? 0 : Math.max(0, Math.floor((deadline - now) / 1000));
}
