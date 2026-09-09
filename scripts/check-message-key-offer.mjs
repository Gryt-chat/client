/* eslint-env node */

/**
 * Which message-key offer a device gets, if any. Offering needlessly costs a
 * dismissal; staying quiet costs everyone's encryption (GRYT-783, GRYT-1130).
 */

import assert from "node:assert/strict";

import { shouldOfferMessageKey } from "../src/packages/common/src/auth/message-vault-adoption.ts";

const offer = (o) => shouldOfferMessageKey(o);

// ── the account has a sealed copy this device has not taken ─────────────────
assert.equal(
  offer({ signedIn: true, vaultExists: true, keyIsHere: false }),
  "adopt",
  "signed in, a sealed copy exists, this device lacks it",
);

// ── no sealed copy anywhere ─────────────────────────────────────────────────
/* The window that does the damage. Nothing to adopt, and one sign-in away from
   every peer refusing to encrypt, so this is the one that has to speak up. */
assert.equal(offer({ signedIn: true, vaultExists: false, keyIsHere: false }), "protect");
assert.equal(
  offer({ signedIn: true, vaultExists: false, keyIsHere: true }),
  "protect",
  "holding a key locally is not the same as the account having a copy of it",
);

// ── quiet once this device holds the account's copy ─────────────────────────
assert.equal(offer({ signedIn: true, vaultExists: true, keyIsHere: true }), null, "already here");

// ── guests are never offered either ─────────────────────────────────────────
for (const vaultExists of [true, false, null]) {
  for (const keyIsHere of [true, false]) {
    assert.equal(
      offer({ signedIn: false, vaultExists, keyIsHere }),
      null,
      "a guest has the 24 words and needs nothing stored",
    );
  }
}

// ── silence while loading, not a flicker ────────────────────────────────────
{
  /* vaultExists starts null. Answering on null would flash a password prompt on
     every DM open and take it away, which reads as a glitch. */
  assert.equal(offer({ signedIn: true, vaultExists: null, keyIsHere: false }), null);
  assert.equal(offer({ signedIn: true, vaultExists: null, keyIsHere: true }), null);
}

// ── every input maps to exactly one of the three ────────────────────────────
{
  const seen = new Set();
  for (const signedIn of [true, false]) {
    for (const vaultExists of [true, false, null]) {
      for (const keyIsHere of [true, false]) {
        const answer = offer({ signedIn, vaultExists, keyIsHere });
        assert.ok(
          answer === "adopt" || answer === "protect" || answer === null,
          `${JSON.stringify({ signedIn, vaultExists, keyIsHere })} answered ${answer}`,
        );
        seen.add(answer);
      }
    }
  }
  assert.deepEqual([...seen].sort(), ["adopt", "protect", null].sort(), "an answer is unreachable");
}

console.log("check-message-key-offer: adopt, protect, and quiet, over every input");
