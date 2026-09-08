/* eslint-env node */

/**
 * The warning shown before a message-key reset never says "nothing to lose" unless
 * it knows that. An unreadable store used to come back as a confident zero.
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
// guest-history rather than message-key: the reset module pulls in identity-keys
// and an IndexedDB it has no business opening to answer a localStorage question.
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

// Nothing on record. Honest most of the time, but a device set up from a phrase
// has no history and may still have guest identities. So: not certain.
assert.equal(riskWith({ raw: null }).certain, false, "an empty history is not proof of none");
assert.equal(riskWith({ raw: "[]" }).certain, false);

// The store cannot be read at all. `read` turns that into an empty list, which is
// why the caller must not treat empty as proof.
assert.equal(riskWith({ throwOnRead: true }).certain, false);

// Present but not a list. Somebody overwrote it; that is not the same as never
// having written anything.
assert.equal(riskWith({ raw: '"nonsense"' }).certain, false);
assert.equal(riskWith({ raw: "{ not json" }).certain, false);

// The property that matters: `certain` is true only when the warning can name a
// real number. Every other answer sends the reader to the general form.
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
