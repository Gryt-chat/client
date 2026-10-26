import { type RefObject, useEffect, useState } from "react";

const IDLE_MS = 3000;

/** True after three seconds without the pointer or a key moving, while `active`. */
export function useIdle(active: boolean, target: RefObject<HTMLElement | null>): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const el = target.current;
    if (!active || !el) {
      setIdle(false);
      return;
    }
    let timer = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown"] as const;
    events.forEach((e) => el.addEventListener(e, wake));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => el.removeEventListener(e, wake));
    };
  }, [active, target]);
  return idle;
}
