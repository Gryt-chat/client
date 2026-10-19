/*
 * Servers that removed this device from MLS (GRYT-1555). Until the person signs in again, or
 * restores their identity, no new device is made there: that's what stops a stolen one coming back.
 */

const PREFIX = "gryt-mls-removed:";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Milliseconds, or null when this device wasn't removed on that server. */
export function removedHereAt(scope: string): number | null {
  try {
    const raw = storage()?.getItem(PREFIX + scope);
    const at = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

export function markRemovedHere(scope: string, at = Date.now()): void {
  try {
    storage()?.setItem(PREFIX + scope, String(at));
  } catch {
    // Without storage the wipe still happens; only the gate on a new device is lost.
  }
}

export function clearRemovedHere(scope: string): void {
  try {
    storage()?.removeItem(PREFIX + scope);
  } catch {
    // Nothing to clear.
  }
}

/** After restoring an identity from its recovery key, which a thief doesn't have. */
export function clearRemovedEverywhere(): void {
  const s = storage();
  if (!s) return;
  try {
    const keys = Array.from({ length: s.length }, (_, i) => s.key(i)).filter((k): k is string => !!k?.startsWith(PREFIX));
    for (const key of keys) s.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

/** A sign-in after the removal lets the device set up again. `authTime` is the token's, in seconds. */
export function stillRemoved(removedAt: number, authTime: number | null): boolean {
  return authTime === null || authTime * 1000 <= removedAt;
}

/** The `auth_time` claim of an account token, or null for a guest or a token without one. */
export function authTimeOf(token: string | undefined | null): number | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { auth_time?: unknown };
    return typeof json.auth_time === "number" ? json.auth_time : null;
  } catch {
    return null;
  }
}
