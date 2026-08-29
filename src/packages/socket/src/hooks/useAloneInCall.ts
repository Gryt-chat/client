import { useEffect, useRef, useState } from "react";

/**
 * Leaving a call once you are the only one left in it (GRYT-711).
 *
 * A voice channel is a place, and sitting in one alone is an ordinary thing to
 * do. A call is an event between named people, and being the last one in it
 * means it is over — usually the other person hung up and you walked off, or
 * the tab is open behind forty others. The room, its peer connection and its
 * socket stay up either way.
 *
 * The SFU ends it too, and that is the half that saves the resources: a client
 * that is closed, wedged or modified never runs this timer, and those are
 * exactly the ones leaving rooms up. This half exists so the person who *is*
 * there is told rather than having the call vanish on them.
 *
 * ## Why there is no "stay in the call" button
 *
 * It would be a lie. The SFU is counting too and is not listening to this
 * client, so pressing Stay would keep the tile up for the thirty seconds until
 * the socket closed anyway. Making the button honest needs the SFU to take a
 * message that resets its clock, which is GRYT-715.
 */

/**
 * Matches `DefaultCallAloneTimeout` in the SFU's config.
 *
 * The same number in two repositories, because there is no route for the SFU
 * to tell a client what it chose — the value is read from the environment on a
 * machine this client never talks to. An operator who raises theirs makes this
 * leave early, which is just a person hanging up. One who turns theirs off
 * makes this leave anyway, and that disagreement is the reason the number is
 * written down here with a name rather than buried in a timer.
 */
export const ALONE_SECONDS = 120;

/** How long the countdown is on screen before it happens. */
export const WARN_SECONDS = 30;

export interface Countdown {
  /** Seconds to show, or null when there is nothing to say yet. */
  secondsLeft: number | null;
  /** The call should end now. */
  ended: boolean;
}

/**
 * What to show after this many seconds alone, and whether to hang up.
 *
 * Pure, and separate from the hook, because this is the part with the
 * boundaries in it: showing the notice a second too late, or counting down to
 * one instead of zero, is not something a type checker or a running app makes
 * obvious. `check-alone-in-call.mjs` walks it second by second.
 */
export function callCountdown(secondsAlone: number): Countdown {
  const remaining = ALONE_SECONDS - secondsAlone;
  return {
    secondsLeft: remaining <= WARN_SECONDS ? Math.max(remaining, 0) : null,
    ended: remaining <= 0,
  };
}

export function useAloneInCall({
  inACall,
  alone,
  onEnd,
}: {
  /** A call, not a voice channel. A channel is never ended for being quiet. */
  inACall: boolean;
  /** Nobody else is here. */
  alone: boolean;
  onEnd: () => void;
}): Countdown {
  const [secondsAlone, setSecondsAlone] = useState<number | null>(null);

  // The callback is rebuilt on every render of the component holding it, and
  // depending on it directly would restart the interval each time — a timer
  // that resets every render never fires.
  const end = useRef(onEnd);
  useEffect(() => {
    end.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    if (!inACall || !alone) {
      setSecondsAlone(null);
      return;
    }

    setSecondsAlone(0);
    const tick = setInterval(() => {
      setSecondsAlone((previous) => (previous ?? 0) + 1);
    }, 1000);
    return () => clearInterval(tick);
  }, [inACall, alone]);

  const countdown =
    secondsAlone === null
      ? { secondsLeft: null, ended: false }
      : callCountdown(secondsAlone);

  // Hanging up in an effect rather than inside the interval, so it happens
  // after the render that drew "0s" — the alternative disconnects on the tick
  // that would have shown it, and the countdown visibly skips the last second.
  useEffect(() => {
    if (countdown.ended) end.current();
  }, [countdown.ended]);

  return countdown;
}
