/** How one failed `/api/link-preview` request came back. */
export type PreviewFailure =
  | { kind: "status"; status: number; retryAfter?: string | null; retryAfterMs?: unknown }
  | { kind: "network" };

export type PreviewStep =
  | { action: "refuse" }
  | { action: "give-up" }
  | { action: "retry"; delayMs: number };

/** Waits before the second and third try after a 5xx or a dropped connection. */
export const TRANSIENT_DELAYS_MS = [2_000, 8_000];

// The server bans for 60s once past 20 a minute, and during the ban it answers Retry-After: 1.
export const RATE_LIMIT_FLOOR_MS = 5_000;
export const RATE_LIMIT_CAP_MS = 60_000;
export const RATE_LIMIT_MAX_ATTEMPTS = 8;

/** Up to this share of the wait is added on top, so a screenful of cards spreads out. */
export const JITTER_SHARE = 0.25;

/** Milliseconds the server asked us to wait, or null when it said nothing usable. */
export function retryAfterHint(
  retryAfter: string | null | undefined,
  retryAfterMs: unknown,
  now: number = Date.now(),
): number | null {
  const header = retryAfter?.trim();
  if (header) {
    if (/^\d+$/.test(header)) return Number(header) * 1000;
    // An HTTP-date always names the day; Date.parse would take "-5" as a year.
    const at = /[a-z]/i.test(header) ? Date.parse(header) : Number.NaN;
    if (!Number.isNaN(at)) return Math.max(0, at - now);
  }
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return retryAfterMs;
  }
  return null;
}

function jittered(delayMs: number, random: () => number): number {
  return Math.round(delayMs + delayMs * JITTER_SHARE * random());
}

/**
 * What to do after the request numbered `attempt` (0 for the first) failed.
 * `random` and `now` are parameters so a check can pin them.
 */
export function nextPreviewStep(
  failure: PreviewFailure,
  attempt: number,
  random: () => number = Math.random,
  now: number = Date.now(),
): PreviewStep {
  if (failure.kind === "status" && failure.status === 429) {
    if (attempt + 1 >= RATE_LIMIT_MAX_ATTEMPTS) return { action: "give-up" };
    const hint = retryAfterHint(failure.retryAfter, failure.retryAfterMs, now) ?? 0;
    const floor = RATE_LIMIT_FLOOR_MS * 2 ** attempt;
    const wait = Math.min(RATE_LIMIT_CAP_MS, Math.max(hint, floor));
    return { action: "retry", delayMs: jittered(wait, random) };
  }

  if (failure.kind === "status" && failure.status >= 400 && failure.status < 500) {
    return { action: "refuse" };
  }

  const delay = TRANSIENT_DELAYS_MS[attempt];
  if (delay === undefined) return { action: "give-up" };
  return { action: "retry", delayMs: jittered(delay, random) };
}
