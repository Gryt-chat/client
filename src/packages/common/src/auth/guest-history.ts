/**
 * Which servers this device has been a guest on (GRYT-285). The seed reproduces
 * every guest key that could exist; this is the separate question of which were
 * ever used somewhere, which derivation cannot answer.
 *
 * **It has to be local, because the server cannot be asked without telling it
 * the answer.** Proving a prior guest identity means signing a link with that
 * guest key, and the moment the proof arrives the account and the guest are the
 * same person — declining afterwards cannot take that back. Per-server
 * unlinkability is what the whole guest design protects, so the question of
 * whether to prove anything has to be answerable without proving anything.
 *
 * **Stores scopes, not addresses** — a server that moves is still the same
 * server (GRYT-257). Nothing here identifies a person.
 */

import { asIdentityScope, type IdentityScope } from "./identity-seed.ts";

const STORAGE_KEY = "gryt_guest_history";

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((s): s is string => typeof s === "string"));
  } catch {
    // Unreadable or unparseable is the same as empty. The cost of being wrong
    // is that somebody is not offered a claim they could have made, and they
    // can still ask for it by hand.
    return new Set();
  }
}

function write(scopes: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...scopes]));
  } catch {
    // Private mode, quota, a disabled store. Losing the record costs the
    // automatic offer and nothing else.
  }
}

/** Note that this device has been a guest under `scope`. Idempotent. */
export function rememberGuestScope(scope: string): void {
  const scopes = read();
  if (scopes.has(scope)) return;
  scopes.add(scope);
  write(scopes);
}

/** Whether this device has ever been a guest under `scope`. */
export function hasGuestScope(scope: string): boolean {
  return read().has(scope);
}

/** Every scope this device has been a guest under. */
export function listGuestScopes(): IdentityScope[] {
  // Everything in here arrived through rememberGuestScope, which is only ever
  // called with identityScopeFor's result.
  return [...read()].map(asIdentityScope);
}

/**
 * How many guest identities are at stake, and whether that number is worth
 * printing. Here rather than beside the reset so a check can exercise it
 * without opening an IndexedDB to answer a question about localStorage.
 *
 * **A count of zero is never a promise.** `read` swallows every failure and
 * answers empty, and a device set up by restoring a 24-word phrase has no
 * history and may still have guest identities — which is exactly the person
 * reaching for a reset. So the warning says so rather than disappearing.
 */
export function guestScopeRisk(): { count: number; certain: boolean } {
  const scopes = read();
  return { count: scopes.size, certain: scopes.size > 0 };
}

/** Drop one, for a server being left. */
export function forgetGuestScope(scope: string): void {
  const scopes = read();
  if (!scopes.delete(scope)) return;
  write(scopes);
}

/**
 * Take in scopes from somewhere that already knows them.
 *
 * Two callers. The backfill in `identity-keys.ts` reads the `local:*` entries
 * an existing install already has, so nobody who upgrades loses the offer to
 * carry an identity over. And restoring a backup file adds the scopes it lists,
 * since a file naming six servers is evidence of having been on six servers.
 *
 * A restored 24-word phrase brings nothing, because a phrase is a seed and a
 * seed knows nothing about where it has been. That case is why the claim has to
 * be reachable by hand as well as offered automatically.
 */
export function rememberGuestScopes(scopes: Iterable<string>): void {
  const known = read();
  let added = false;
  for (const scope of scopes) {
    if (!scope || known.has(scope)) continue;
    known.add(scope);
    added = true;
  }
  if (added) write(known);
}
