/* eslint-env node */

/**
 * When to offer a device the account's message key (GRYT-783).
 *
 * The two failures worth guarding are opposites and only one of them is
 * survivable.
 *
 * Offering when it was not needed costs a dismissal. Staying quiet when it was
 * needed means somebody goes on writing messages their other devices cannot
 * read, and nothing ever tells them why — which is the exact complaint that
 * started GRYT-783, arrived at from the other direction.
 *
 * So the table below is mostly about the second one: while the answer is still
 * loading, say nothing; once it is known, do not go quiet for any reason except
 * the key genuinely being here.
 */

import assert from "node:assert/strict";

import {
  shouldOfferMessageKey,
} from "../src/packages/common/src/auth/message-vault-adoption.ts";

const offer = (o) => shouldOfferMessageKey(o);

// ── the case the feature exists for ─────────────────────────────────────────
assert.equal(
  offer({ signedIn: true, vaultExists: true, keyIsHere: false }),
  true,
  "signed in, a sealed copy exists, this device lacks it — this is the whole point",
);

// ── quiet when there is nothing to offer ────────────────────────────────────
assert.equal(offer({ signedIn: true, vaultExists: true, keyIsHere: true }), false, "already here");
assert.equal(offer({ signedIn: true, vaultExists: false, keyIsHere: false }), false, "none sealed");

// ── guests are never offered it ─────────────────────────────────────────────
for (const vaultExists of [true, false, null]) {
  for (const keyIsHere of [true, false]) {
    assert.equal(
      offer({ signedIn: false, vaultExists, keyIsHere }),
      false,
      "a guest has the 24 words and needs nothing stored",
    );
  }
}

// ── silence while loading, not a flicker ────────────────────────────────────
{
  // vaultExists starts null. Offering on null would flash a password prompt on
  // every DM open and then take it away, which reads as a glitch — and this is
  // the last thing that should flicker.
  assert.equal(offer({ signedIn: true, vaultExists: null, keyIsHere: false }), false);
  assert.equal(offer({ signedIn: true, vaultExists: null, keyIsHere: true }), false);
}

// ── the marker is the only thing that silences a real offer ─────────────────
{
  // Guarding the direction of the fallback: everything except keyIsHere being
  // true should still offer.
  const base = { signedIn: true, vaultExists: true };
  assert.equal(offer({ ...base, keyIsHere: false }), true);
  assert.equal(offer({ ...base, keyIsHere: true }), false);
}

console.log("check-message-key-offer: ok");
