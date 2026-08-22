import { useEffect } from "react";

/**
 * The two things a report knows about this run that the form cannot see for
 * itself.
 *
 * **Where they were.** The service's `context.route` wants "where in the app
 * they were", and the obvious reading — ask the form — answers "the report
 * form", which is the one place that cannot be the reason for a bug report.
 * Settings does not record either, for the same reason: the report is opened
 * from About, and "About" is never the answer.
 *
 * **How long they had been running.** `context.sessionUptimeSec`. "It broke
 * twenty minutes in" and "it broke on launch" are different bugs, and nobody
 * thinks to write down which one it was.
 *
 * Module variables rather than context, because nothing should re-render on
 * either of these.
 */

const startedAt = Date.now();

let place: string | null = null;

/** Called from the main view, which is the only place worth remembering. */
export function useRememberPlace(value: string): void {
  useEffect(() => {
    place = value;
  }, [value]);
}

export function lastPlace(): string | null {
  return place;
}

/**
 * Seconds since this module was first imported, which is app start.
 *
 * Not since the form opened, and not the machine's uptime. Whole seconds
 * because the service stores it as a number somebody reads, and a fractional
 * one implies a precision a bug report does not have.
 */
export function sessionUptimeSec(): number {
  return Math.round((Date.now() - startedAt) / 1000);
}
