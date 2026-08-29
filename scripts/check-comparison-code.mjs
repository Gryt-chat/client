/* eslint-env node */

/**
 * The code two people read to each other (GRYT-730).
 *
 * This is the last check standing between somebody and a server that put itself
 * in the middle from the first message, and every way of getting it wrong is
 * quiet. A code that ignores half its input matches while the keys differ. A
 * code that depends on argument order never matches even when everything is
 * fine, which teaches people the check is broken and to skip it. A "verified"
 * mark that survives a key change says the wrong thing at exactly the moment it
 * matters most.
 *
 * `localStorage` is faked for the pin half. Node 24 strips the types.
 */

import assert from "node:assert/strict";

import {
  COMPARISON_CODE_DIGITS,
  comparisonCode,
} from "../src/packages/common/src/auth/comparison-code.ts";
import { asIdentityScope } from "../src/packages/common/src/auth/identity-seed.ts";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { getPeerPin, markPeerCompared, pinPeerKey } = await import(
  "../src/packages/common/src/auth/peer-keys.ts"
);

const alice = { thumbprint: "tp-alice", dmPublicKey: "dm-alice" };
const bob = { thumbprint: "tp-bob", dmPublicKey: "dm-bob" };
const mallory = { thumbprint: "tp-mallory", dmPublicKey: "dm-mallory" };

const digitsOnly = (code) => code.replace(/ /g, "");

/* ── both sides compute the same string ─────────────────────────────────── */

{
  // The point of sorting. Alice runs it with herself first and Bob runs it with
  // himself first; if these differed, two honest people would read out
  // different codes and conclude they were being attacked.
  assert.equal(comparisonCode(alice, bob), comparisonCode(bob, alice),
    "the code must not depend on who computes it");
}

/* ── it is readable ─────────────────────────────────────────────────────── */

{
  const code = comparisonCode(alice, bob);

  assert.equal(digitsOnly(code).length, COMPARISON_CODE_DIGITS);
  assert.ok(/^[0-9]+( [0-9]+)*$/.test(code), `"${code}" is not digits in groups`);
  assert.equal(code.split(" ").length, 12, "twelve groups is what fits three rows");
  assert.ok(
    code.split(" ").every((group) => group.length === 5),
    "even groups, so somebody can keep their place halfway down a phone call",
  );

  // Never words. The identity backup is 24 words from the BIP39 list, and a
  // second set of words on a card beside it reads as another recovery phrase —
  // something to keep secret and type into a box, which this is the opposite of.
  assert.ok(!/[a-z]/i.test(code), `"${code}" contains letters`);
}

/* ── every one of the four halves changes it ────────────────────────────── */

{
  const base = comparisonCode(alice, bob);

  const variants = {
    "their identity key": comparisonCode(alice, { ...bob, thumbprint: "tp-other" }),
    "their message key": comparisonCode(alice, { ...bob, dmPublicKey: "dm-other" }),
    "my identity key": comparisonCode({ ...alice, thumbprint: "tp-other" }, bob),
    "my message key": comparisonCode({ ...alice, dmPublicKey: "dm-other" }, bob),
  };

  for (const [what, code] of Object.entries(variants)) {
    assert.notEqual(code, base,
      `substituting ${what} left the code unchanged, so the comparison would pass`);
  }

  // And a different person entirely, which is the case somebody is actually
  // checking for.
  assert.notEqual(comparisonCode(alice, mallory), base);
}

/* ── two different pairs cannot produce one input ───────────────────────── */

{
  /*
   * This one found a real flaw. Joining a thumbprint and a key on ":" makes
   * ("a", "b:c") and ("a:b", "c") the same string, so two different pairs of
   * keys got the same code. Neither field contains a colon today, so it was
   * unreachable — and unreachable until somebody changes what goes in here.
   */
  assert.notEqual(
    comparisonCode({ thumbprint: "a", dmPublicKey: "b:c" }, { thumbprint: "d", dmPublicKey: "e" }),
    comparisonCode({ thumbprint: "a:b", dmPublicKey: "c" }, { thumbprint: "d", dmPublicKey: "e" }),
    "two different pairs hashed to the same input",
  );

  // The same, for the separator between the two halves.
  assert.notEqual(
    comparisonCode({ thumbprint: "a", dmPublicKey: "b" }, { thumbprint: "c", dmPublicKey: "d" }),
    comparisonCode({ thumbprint: "a", dmPublicKey: 'b","c' }, { thumbprint: "", dmPublicKey: "d" }),
  );
}

/* ── the digits do not repeat ───────────────────────────────────────────── */

{
  /*
   * Also found a real flaw. SHA-256 gives 32 bytes and the code wants 60
   * digits; taking `bytes[i % 32]` repeats digits 0 to 27 at the end, which
   * halves what the code distinguishes and prints a visible run — a code that
   * looks broken is one people stop reading out.
   */
  const digits = digitsOnly(comparisonCode(alice, bob));
  const half = COMPARISON_CODE_DIGITS - 32;

  assert.notEqual(digits.slice(32), digits.slice(0, half),
    "the tail of the code repeats its head, so the hash is being wrapped");

  // And no long run of one digit, which is the other way a bad stretch shows up.
  assert.ok(!/(\d)\1{5}/.test(digits), `"${digits}" has a run of six identical digits`);
}

/* ── marking a comparison, and losing it ────────────────────────────────── */

const SCOPE = asIdentityScope("srv:compare");
const BOB = "user_bob";

const verified = (dm) => ({
  identityThumbprint: "tp-bob",
  dmPublicKey: Uint8Array.from(dm),
  scope: SCOPE,
  signedAt: 0,
});

{
  const first = verified([1, 2, 3]);
  pinPeerKey(SCOPE, BOB, first);
  const pin = getPeerPin(SCOPE, BOB);

  assert.equal(pin.comparedAt, undefined, "nothing is compared until somebody compares it");

  assert.equal(
    markPeerCompared(SCOPE, BOB, {
      thumbprint: pin.thumbprint,
      dmPublicKey: pin.dmPublicKey,
    }),
    true,
  );
  assert.ok(getPeerPin(SCOPE, BOB).comparedAt > 0);
}

{
  // Between reading a code aloud and pressing the button, a member list can land
  // and move the pin. Marking blind would put "verified" against keys nobody
  // ever compared.
  assert.equal(
    markPeerCompared(SCOPE, BOB, { thumbprint: "tp-bob", dmPublicKey: "not-what-is-pinned" }),
    false,
    "marking keys that are not the pinned ones has to be refused",
  );
}

{
  // Re-pinning the same keys keeps it. This is an ordinary member list landing
  // again, and losing the mark every time one arrived would make it useless.
  pinPeerKey(SCOPE, BOB, verified([1, 2, 3]));
  assert.ok(getPeerPin(SCOPE, BOB).comparedAt > 0,
    "the same keys arriving again must not throw away a comparison");
}

{
  // A new key. Somebody who compared a code last year and whose peer has since
  // arrived with a different key has verified nothing.
  pinPeerKey(SCOPE, BOB, verified([9, 9, 9]));
  assert.equal(getPeerPin(SCOPE, BOB).comparedAt, undefined,
    "a changed key must take the verified mark with it");
}

console.log(
  `comparison-code: ${COMPARISON_CODE_DIGITS} digits, same from either side, moves when any of the four keys does, and the verified mark dies with the key`,
);
