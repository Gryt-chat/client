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
 *
 * Each scope also carries when it was last used, so the prompt asking whether
 * to convert a guest membership has something to show. That date comes off this
 * device and never off the server, for the reason above. No nickname: the local
 * one is device-wide, so it would print the name you have now rather than the
 * name that membership carries.
 */

import { asIdentityScope, type IdentityScope } from "./identity-seed.ts";

const STORAGE_KEY = "gryt_guest_history";

/** What this device knows about one guest membership. */
export interface GuestVisit {
  /**
   * Epoch ms of the last guest key derive for this scope. Null for an entry
   * written before this field existed, and for scopes taken in by the backfill
   * or from a backup file, neither of which knows a date.
   */
  lastUsed: number | null;
}

type History = Map<string, GuestVisit>;

/**
 * Reads both shapes. This was a bare array of scope strings until the date was
 * added, and those entries stay valid with nothing known about when they were
 * used — somebody who upgrades mid-membership still has to be offered the
 * conversion.
 */
function read(): History {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return new Map(
        parsed
          .filter((s): s is string => typeof s === "string")
          .map((scope) => [scope, { lastUsed: null }]),
      );
    }

    if (!parsed || typeof parsed !== "object") return new Map();

    const out: History = new Map();
    for (const [scope, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!scope) continue;
      const lastUsed =
        value !== null &&
        typeof value === "object" &&
        typeof (value as Partial<GuestVisit>).lastUsed === "number"
          ? (value as GuestVisit).lastUsed
          : null;
      out.set(scope, { lastUsed });
    }
    return out;
  } catch {
    // Unreadable or unparseable is the same as empty. The cost of being wrong
    // is that somebody is not offered a claim they could have made, and they
    // can still ask for it by hand.
    return new Map();
  }
}

function write(history: History): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(history)));
  } catch {
    // Private mode, quota, a disabled store. Losing the record costs the
    // automatic offer and nothing else.
  }
}

/**
 * Note that this device has been a guest under `scope`, and when.
 *
 * Writes every call rather than returning early on a scope already known,
 * because the date is the point of it. The caller is the guest key derivation,
 * which the in-memory key cache reduces to about once a session — so this reads
 * as "last used", not "last connected".
 */
export function rememberGuestScope(scope: string): void {
  const history = read();
  history.set(scope, { lastUsed: Date.now() });
  write(history);
}

/** Whether this device has ever been a guest under `scope`. */
export function hasGuestScope(scope: string): boolean {
  return read().has(scope);
}

/** What is known about one scope, or null if this device has never used it. */
export function getGuestVisit(scope: string): GuestVisit | null {
  return read().get(scope) ?? null;
}

/** Every scope this device has been a guest under. */
export function listGuestScopes(): IdentityScope[] {
  // Everything in here arrived through rememberGuestScope, which is only ever
  // called with identityScopeFor's result.
  return [...read().keys()].map(asIdentityScope);
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
  const history = read();
  return { count: history.size, certain: history.size > 0 };
}

/** Drop one, for a server being left. */
export function forgetGuestScope(scope: string): void {
  const history = read();
  if (!history.delete(scope)) return;
  write(history);
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
 *
 * **These arrive with no date and must not be given one.** Neither source knows
 * when the membership was used, and a `Date.now()` here would show on the prompt
 * as "last used today", which is the one thing it is not.
 */
export function rememberGuestScopes(scopes: Iterable<string>): void {
  const known = read();
  let added = false;
  for (const scope of scopes) {
    if (!scope || known.has(scope)) continue;
    known.set(scope, { lastUsed: null });
    added = true;
  }
  if (added) write(known);
}
