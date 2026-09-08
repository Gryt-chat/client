import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Leaving a call once you are the only one left. The SFU counts too and is what
 * frees the resources; this half is so the person there is told (GRYT-711).
 */

/**
 * What to count down from when the SFU has not said. Matches
 * `DefaultCallAloneTimeout`; a fallback for an SFU too old to send one.
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
   * Start the count again. Only the local half — the SFU has its own clock and is
   * told with `still_here` by the caller, which holds that connection.
   */
  stay: () => void;
}

/**
 * What to show after this many seconds alone, and whether to hang up. Pure and
 * separate because the boundaries are the part a type checker cannot catch.
 */
export function callCountdown(
  secondsAlone: number,
  aloneSeconds: number = ALONE_SECONDS,
): Countdown {
  // The SFU's off switch, SFU_CALL_ALONE_TIMEOUT=0. Nothing counts on the other
  // end, so nothing counts here — the disagreement GRYT-715 removed.
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
   * What the SFU said its own timeout is, in seconds. Zero means it does not end
   * calls; undefined means it did not say, and {@link ALONE_SECONDS} is used.
   */
  aloneSeconds?: number | null;
  onEnd: () => void;
}): AloneInCall {
  const [secondsAlone, setSecondsAlone] = useState<number | null>(null);
  const limit = aloneSeconds ?? ALONE_SECONDS;

  // The callback is rebuilt every render, and depending on it would restart the
  // interval each time — a timer that resets every render never fires.
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

  // Back to zero, not to the start of the warning window: the SFU restarts its
  // whole clock on `still_here`, so a countdown reappearing counts to nothing.
  const stay = useCallback(() => {
    setSecondsAlone((previous) => (previous === null ? null : 0));
  }, []);

  // Hanging up in an effect rather than in the interval, so it happens after the
  // render that drew "0s" — otherwise the countdown skips the last second.
  useEffect(() => {
    if (countdown.ended) end.current();
  }, [countdown.ended]);

  return { ...countdown, stay };
}
