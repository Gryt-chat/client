/**
 * Which servers this device has been a guest on. **It has to be local: the server
 * cannot be asked without telling it the answer.** Scopes, not addresses.
 */

import { asIdentityScope, type IdentityScope } from "./identity-seed.ts";

const STORAGE_KEY = "gryt_guest_history";

/** What this device knows about one guest membership. */
export interface GuestVisit {
  /**
   * Epoch ms of the last guest key derive for this scope. Null for an older entry,
   * and for scopes taken in by the backfill or from a backup file.
   */
  lastUsed: number | null;
}

type History = Map<string, GuestVisit>;

/**
 * Reads both shapes. This was a bare array of scope strings until the date was
 * added, and those entries stay valid with nothing known about when.
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
    // Unreadable or unparseable is the same as empty: the cost is that somebody is
    // not offered a claim, and they can still ask for it by hand.
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
 * Note that this device has been a guest under `scope`, and when. Writes every
 * call, because the date is the point — it reads as "last used".
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
 * printing. **A count of zero is never a promise**: `read` swallows failures.
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
 * Take in scopes from somewhere that already knows them — the backfill, or a
 * restored backup file. **These arrive with no date and must not be given one.**
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
