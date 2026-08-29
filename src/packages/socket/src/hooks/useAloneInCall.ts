import { useCallback, useEffect, useRef, useState } from "react";

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
 * ## The stay button
 *
 * There was no button at first, because it would have been a lie: the SFU was
 * counting too and was not listening, so pressing Stay would have held the tile
 * up for thirty seconds and then the socket would have closed anyway. GRYT-715
 * gave the SFU a `still_here` message that restarts its clock, so the button
 * now moves both. `stay()` restarts this one; sending the message is the
 * caller's job, because it is the caller that holds the SFU connection.
 */

/**
 * What to count down from when the SFU has not said.
 *
 * It matches `DefaultCallAloneTimeout` in the SFU's config, and it used to be
 * the only number this had: the value is read from the environment on a machine
 * this client never talks to, and there was no route back. GRYT-715 gave
 * `room_joined` one, so this is now the fallback for an SFU too old to use it
 * rather than a guess made on every call.
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

export interface AloneInCall extends Countdown {
  /**
   * Start the count again, because somebody said they are still here.
   *
   * This is only the local half. The SFU has its own clock and has to be told
   * separately, with `still_here` — the caller does that, because the caller is
   * what holds the SFU connection.
   */
  stay: () => void;
}

/**
 * What to show after this many seconds alone, and whether to hang up.
 *
 * Pure, and separate from the hook, because this is the part with the
 * boundaries in it: showing the notice a second too late, or counting down to
 * one instead of zero, is not something a type checker or a running app makes
 * obvious. `check-alone-in-call.mjs` walks it second by second.
 */
export function callCountdown(
  secondsAlone: number,
  aloneSeconds: number = ALONE_SECONDS,
): Countdown {
  // The SFU's off switch, SFU_CALL_ALONE_TIMEOUT=0. Nothing is counting on the
  // other end, so nothing should be counting here — a client that hung up after
  // two minutes anyway was the disagreement GRYT-715 set out to remove.
  if (aloneSeconds <= 0) return { secondsLeft: null, ended: false };

  const remaining = aloneSeconds - secondsAlone;
  return {
    secondsLeft: remaining <= WARN_SECONDS ? Math.max(remaining, 0) : null,
    ended: remaining <= 0,
  };
}

export function useAloneInCall({
  inACall,
  alone,
  aloneSeconds,
  onEnd,
}: {
  /** A call, not a voice channel. A channel is never ended for being quiet. */
  inACall: boolean;
  /** Nobody else is here. */
  alone: boolean;
  /**
   * What the SFU said its own timeout is, in seconds. Zero means it does not
   * end calls at all. Undefined means it did not say, and {@link ALONE_SECONDS}
   * is used.
   */
  aloneSeconds?: number | null;
  onEnd: () => void;
}): AloneInCall {
  const [secondsAlone, setSecondsAlone] = useState<number | null>(null);
  const limit = aloneSeconds ?? ALONE_SECONDS;

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
      : callCountdown(secondsAlone, limit);

  // Somebody said they are here. Back to zero, not back to the start of the
  // warning window: the SFU restarts its whole clock on `still_here`, and a
  // countdown that reappeared thirty seconds later would be counting down to
  // nothing.
  const stay = useCallback(() => {
    setSecondsAlone((previous) => (previous === null ? null : 0));
  }, []);

  // Hanging up in an effect rather than inside the interval, so it happens
  // after the render that drew "0s" — the alternative disconnects on the tick
  // that would have shown it, and the countdown visibly skips the last second.
  useEffect(() => {
    if (countdown.ended) end.current();
  }, [countdown.ended]);

  return { ...countdown, stay };
}
