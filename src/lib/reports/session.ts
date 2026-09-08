import { useEffect } from "react";

/**
 * The two things a report knows about this run that the form cannot see: where
 * they were, and how long they had been running. Module variables, not context.
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
 * Seconds since this module was first imported, which is app start. Whole
 * seconds: a fractional one implies a precision a bug report does not have.
 */
export function sessionUptimeSec(): number {
  return Math.round((Date.now() - startedAt) / 1000);
}
