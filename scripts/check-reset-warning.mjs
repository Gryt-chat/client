/* eslint-env node */

/**
 * The warning shown before a message-key reset never says "nothing to lose"
 * unless it knows that.
 *
 * A reset replaces the seed, and on a server joined without an account the
 * signing key is derived from the seed — so a new seed is a new person there,
 * with the roles and ownership gone and no way back. The count of those servers
 * is the only thing standing between that and it happening quietly.
 *
 * The first version of this had a guard for "could not tell" that could never
 * fire: `guestIdentitiesAtRisk` caught exceptions and returned -1, but
 * `listGuestScopes` had already caught its own and returned an empty list. An
 * unreadable store came back as a confident zero, and the UI printed nothing
 * at all. Nothing failed; the guard was simply unreachable.
 *
 * So this checks the property rather than the shape: for every way the store
 * can answer, is the count either right or explicitly uncertain?
 */

import assert from "node:assert/strict";

const KEY = "gryt_guest_history";

/** A localStorage that can be made to behave badly on purpose. */
function installStore(behaviour) {
  globalThis.localStorage = {
    getItem(key) {
      if (behaviour.throwOnRead) throw new DOMException("denied", "SecurityError");
      return key === KEY ? behaviour.raw ?? null : null;
    },
    setItem() {},
    removeItem() {},
  };
}

installStore({ raw: null });
// guest-history rather than message-key: the reset module pulls in
// identity-keys and an IndexedDB it has no business opening to answer a
// question about localStorage. `guestIdentitiesAtRisk` is a try/catch around
// this, and the UI calls that.
const { guestScopeRisk } = await import(
  "../src/packages/common/src/auth/guest-history.ts"
);

/** Re-read with a fresh store behaviour. It reads through on each call. */
function riskWith(behaviour) {
  installStore(behaviour);
  return guestScopeRisk();
}

// Two guest servers on record: a number, and it is trusted.
assert.deepEqual(
  riskWith({ raw: JSON.stringify(["local:a.example.com", "local:b.example.com"]) }),
  { count: 2, certain: true },
);

// One.
assert.deepEqual(riskWith({ raw: JSON.stringify(["local:a.example.com"]) }), {
  count: 1,
  certain: true,
});

// Nothing on record. Honest most of the time, but a device set up from a
// 24-word phrase has no history and may still have guest identities — which is
// exactly the person reaching for a reset. So: not certain.
assert.equal(riskWith({ raw: null }).certain, false, "an empty history is not proof of none");
assert.equal(riskWith({ raw: "[]" }).certain, false);

// The store cannot be read at all. Private mode, disabled site data, quota.
// `read` turns that into an empty list on purpose, which is why the caller
// must not treat empty as proof — this is the case the old guard was written
// for and could never actually catch.
assert.equal(riskWith({ throwOnRead: true }).certain, false);

// Present but not a list. Somebody overwrote it; that is not the same as never
// having written anything.
assert.equal(riskWith({ raw: '"nonsense"' }).certain, false);
assert.equal(riskWith({ raw: "{ not json" }).certain, false);

// The property that matters, stated once: `certain` is true only when the
// warning can name a real number. Every other answer has to send the reader to
// the general form.
for (const behaviour of [
  { raw: null },
  { raw: "[]" },
  { raw: '"nonsense"' },
  { raw: "{ not json" },
  { throwOnRead: true },
]) {
  const risk = riskWith(behaviour);
  assert.ok(
    !risk.certain,
    `an unknowable history reported certain=true for ${JSON.stringify(behaviour)}`,
  );
}

// And a real list is never reported as unknowable, or the specific warning
// would never be shown to anybody.
assert.ok(riskWith({ raw: JSON.stringify(["local:a.example.com"]) }).certain);

// Junk entries inside a valid list are dropped rather than counted, so the
// number in the warning is the number of servers.
assert.deepEqual(riskWith({ raw: JSON.stringify(["local:a.example.com", 42, null]) }), {
  count: 1,
  certain: true,
});

console.log("reset warning: ok");
