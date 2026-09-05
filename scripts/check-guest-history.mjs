/* eslint-env node */

/**
 * The guest history reads what earlier versions of itself wrote, and only
 * claims a date it actually has.
 *
 * This stored a bare array of scope strings until the prompt needed something
 * to show. Anybody mid-membership at the moment they upgrade has that array on
 * disk, and dropping it would take away the offer to convert a guest user on
 * every server they had already joined — silently, because a missing offer
 * looks exactly like having nothing to convert.
 *
 * The other half is the date not being invented. `rememberGuestScopes` takes
 * scopes from the backfill and from a restored backup file, neither of which
 * knows when the membership was used. A `Date.now()` there would print "last
 * used today" on the prompt for a server somebody last touched a year ago,
 * which is worse than printing nothing: it is evidence, and it is wrong.
 */

import assert from "node:assert/strict";

const KEY = "gryt_guest_history";

/** A localStorage that actually stores, so writes can be read back. */
function installStore(raw) {
  let value = raw ?? null;
  globalThis.localStorage = {
    getItem: (key) => (key === KEY ? value : null),
    setItem: (key, next) => {
      if (key === KEY) value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
  return () => (value === null ? null : JSON.parse(value));
}

const {
  getGuestVisit,
  guestScopeRisk,
  hasGuestScope,
  listGuestScopes,
  forgetGuestScope,
  rememberGuestScope,
  rememberGuestScopes,
} = await import("../src/packages/common/src/auth/guest-history.ts");

const A = "local:a.example.com";
const B = "local:b.example.com";

// ── The old array shape still counts ────────────────────────────────────────

installStore(JSON.stringify([A, B]));
assert.ok(hasGuestScope(A), "a scope from the old array shape is still known");
assert.deepEqual(listGuestScopes().sort(), [A, B].sort());
assert.deepEqual(guestScopeRisk(), { count: 2, certain: true });

// Known, but with nothing claimed about when. The prompt drops the date line
// rather than guessing at one.
assert.deepEqual(getGuestVisit(A), { lastUsed: null });

// ── A date is written, and refreshed ────────────────────────────────────────

const readBack = installStore(null);
const before = Date.now();
rememberGuestScope(A);
const first = getGuestVisit(A);
assert.ok(typeof first.lastUsed === "number", "remembering a scope stamps a date");
assert.ok(first.lastUsed >= before, "and the date is now, not the epoch");

// The object shape is what gets written, not the array.
assert.ok(!Array.isArray(readBack()), "writes use the object shape");

// Called again for a scope already known, the date moves. The early return this
// used to have made the field permanently the date of the first ever visit.
first.lastUsed = 0;
installStore(JSON.stringify({ [A]: { lastUsed: 0 } }));
rememberGuestScope(A);
assert.ok(getGuestVisit(A).lastUsed > 0, "a second visit updates the date");

// ── Scopes taken in from elsewhere get no date ──────────────────────────────

installStore(null);
rememberGuestScopes([A, B]);
assert.deepEqual(getGuestVisit(A), { lastUsed: null }, "the backfill invents no date");
assert.deepEqual(getGuestVisit(B), { lastUsed: null });
assert.ok(hasGuestScope(B), "but they are still known, so the offer is made");

// An existing date survives a backfill that names the same scope.
installStore(JSON.stringify({ [A]: { lastUsed: 1234 } }));
rememberGuestScopes([A, B]);
assert.equal(getGuestVisit(A).lastUsed, 1234, "a known scope keeps its date");

// ── Junk, and things that are not there ─────────────────────────────────────

installStore(JSON.stringify({ [A]: { lastUsed: "tuesday" }, [B]: null }));
assert.deepEqual(getGuestVisit(A), { lastUsed: null }, "a non-number date is no date");
assert.deepEqual(getGuestVisit(B), { lastUsed: null }, "and so is no entry at all");
assert.equal(guestScopeRisk().count, 2, "both are still servers that were joined");

installStore(null);
assert.equal(getGuestVisit(A), null, "a scope never used has no visit");
assert.equal(hasGuestScope(A), false);

// ── Leaving a server drops it ───────────────────────────────────────────────

installStore(null);
rememberGuestScope(A);
rememberGuestScope(B);
forgetGuestScope(A);
assert.equal(hasGuestScope(A), false, "leaving forgets the scope");
assert.ok(hasGuestScope(B), "and leaves the others alone");

// ── An unreadable store is empty rather than an error ───────────────────────

globalThis.localStorage = {
  getItem() {
    throw new DOMException("denied", "SecurityError");
  },
  setItem() {},
  removeItem() {},
};
assert.equal(getGuestVisit(A), null);
assert.deepEqual(listGuestScopes(), []);

console.log("guest history: ok");
