/* When to refresh one server's access token: from its own expiry, offset per host,
   so servers that handed out tokens in the same second are not all asked at once. */

/** Ahead of the five minutes `shouldRefreshToken` uses, so a send never waits on it. */
export const REFRESH_LEAD_MS = 6 * 60_000;
export const REFRESH_SPREAD_MS = 2 * 60_000;

/** The soonest a refresh goes out, spread a little too, since after a reconnect
    every token may already be due. */
export const MIN_REFRESH_DELAY_MS = 3_000;
export const SOON_SPREAD_MS = 5_000;

/** For a server that did not answer. The fixed cadence this replaced. */
export const RETRY_DELAY_MS = 4 * 60_000;

/** Stable for a host, so re-planning after every refresh keeps servers apart. */
export function hostOffsetMs(host: string, spreadMs: number): number {
  let hash = 2166136261;
  for (let i = 0; i < host.length; i++) {
    hash ^= host.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % spreadMs;
}

/** `expiresAtMs` is null for no token, or one whose expiry cannot be read. */
export function refreshDelayMs(host: string, expiresAtMs: number | null, now: number): number {
  const soonest = MIN_REFRESH_DELAY_MS + hostOffsetMs(host, SOON_SPREAD_MS);
  if (expiresAtMs === null) return soonest;
  const due = expiresAtMs - REFRESH_LEAD_MS - hostOffsetMs(host, REFRESH_SPREAD_MS);
  return Math.max(soonest, due - now);
}
