/* eslint-env node */

/**
 * The half of pinning that is this client's (GRYT-732).
 *
 * Deciding whether a key is the one seen before lives in `@gryt/crypto` and is
 * checked there, against a store held in a variable. What is left here is the
 * store itself and the wrappers that supply it — small enough to look right and
 * still be wrong in a way nothing else would notice.
 *
 * Two failures in particular are silent. A wrapper that builds a fresh store
 * per call reads and writes an empty map, so every peer is `first` forever and
 * a substituted key is never refused — and every assertion inside one call still
 * passes. A store that writes under a different key than `PEER_PINS_KEY` loses
 * every pin on reload and looks identical until then. So the assertions go
 * through raw `localStorage` rather than through the module that wrote it.
 *
 * `localStorage` is faked because Node has none. Node 24 strips the types on
 * import.
 */

import assert from "node:assert/strict";

import { PEER_PINS_KEY, signDmKeyBinding, deriveDmKeyPair } from "@gryt/crypto";
import { asIdentityScope } from "../src/packages/common/src/auth/identity-seed.ts";

const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
  clear: () => backing.clear(),
};

const {
  evaluatePeerKey,
  forgetPeerPin,
  forgetPeerPinsForScope,
  getPeerPin,
  listPeerPins,
  localPeerPinStore,
  markPeerCompared,
  pinPeerKey,
} = await import("../src/packages/common/src/auth/peer-keys.ts");

const SCOPE = asIdentityScope("srv:abc123");
const OTHER_SCOPE = asIdentityScope("srv:def456");
const BOB = "user_bob";

const seed = (n) => Uint8Array.from({ length: 32 }, (_, i) => (i * n + n) % 251);

async function identity() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateKey: pair.privateKey,
    publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}

const bob = await identity();

const bind = ({ dmSeed = 7, scope = SCOPE } = {}) =>
  signDmKeyBinding({
    dmPublicKey: deriveDmKeyPair(seed(dmSeed), scope).publicKey,
    scope,
    identityPrivateKey: bob.privateKey,
    identityPublicJwk: bob.publicJwk,
  });

/** What is actually on disk, read without going through the module under test. */
const stored = () => JSON.parse(localStorage.getItem(PEER_PINS_KEY) ?? "{}");

/* ── a pin lands in localStorage, under the key the package names ───────── */

{
  const binding = await bind();
  const first = await evaluatePeerKey({ scope: SCOPE, memberId: BOB, binding });
  assert.equal(first.kind, "first");
  assert.equal(localStorage.getItem(PEER_PINS_KEY), null,
    "evaluating must not write; the caller decides when to pin");

  pinPeerKey(SCOPE, BOB, first.verified);

  const raw = stored();
  assert.equal(Object.keys(raw).length, 1, "the pin has to reach storage");
  assert.equal(Object.values(raw)[0].thumbprint, first.verified.identityThumbprint);

  // `PEER_PINS_KEY` is the package's constant rather than a copy, so mobile and
  // the desktop cannot drift onto two names for the same thing.
  assert.equal(PEER_PINS_KEY, "peerDmKeyPins",
    "changing this key orphans every pin already written; it is not a rename");
}

/* ── the next call reads what the last one wrote ────────────────────────── */

{
  // The failure this catches is a wrapper that constructs its own store each
  // time. Everything inside one call still works, and nothing is ever pinned.
  const binding = await bind();
  assert.equal((await evaluatePeerKey({ scope: SCOPE, memberId: BOB, binding })).kind,
    "known", "a pin written by one call has to be visible to the next");
  assert.notEqual(getPeerPin(SCOPE, BOB), null);
  assert.equal(Object.keys(listPeerPins()).length, 1);
}

/* ── and reads what a previous run of the app wrote ─────────────────────── */

{
  // A reload is only this: the module's own memory is gone and localStorage is
  // not. Faked here by writing the map directly and reading it back through the
  // module, which is the direction a stale in-memory cache would fail in.
  const raw = stored();
  const key = Object.keys(raw)[0];
  backing.set(PEER_PINS_KEY, JSON.stringify({
    ...raw,
    [key]: { ...raw[key], comparedAt: 1234 },
  }));

  assert.equal(getPeerPin(SCOPE, BOB).comparedAt, 1234,
    "a pin has to be read from storage every time, not cached at import");
}

/* ── every wrapper passes the store, not just the ones read so far ──────── */

{
  assert.equal(markPeerCompared(SCOPE, BOB, {
    thumbprint: getPeerPin(SCOPE, BOB).thumbprint,
    dmPublicKey: getPeerPin(SCOPE, BOB).dmPublicKey,
  }, 5678), true);
  assert.equal(stored()[Object.keys(stored())[0]].comparedAt, 5678,
    "markPeerCompared has to write through to storage");

  const other = await bind({ scope: OTHER_SCOPE });
  const there = await evaluatePeerKey({ scope: OTHER_SCOPE, memberId: BOB, binding: other });
  pinPeerKey(OTHER_SCOPE, BOB, there.verified);
  assert.equal(Object.keys(stored()).length, 2);

  forgetPeerPinsForScope(OTHER_SCOPE);
  assert.equal(Object.keys(stored()).length, 1,
    "forgetPeerPinsForScope has to write through to storage");

  forgetPeerPin(SCOPE, BOB);
  assert.equal(Object.keys(stored()).length, 0,
    "forgetPeerPin has to write through to storage");
}

/* ── storage that throws is survivable, and does not lose the answer ────── */

{
  const working = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("full"); },
  };

  assert.deepEqual(localPeerPinStore.read(), {},
    "an unreadable store reads as empty rather than throwing into a member list");
  localPeerPinStore.write({ a: 1 });

  const binding = await bind();
  assert.equal((await evaluatePeerKey({ scope: SCOPE, memberId: BOB, binding })).kind,
    "first", "a decision still comes back when storage is gone");

  globalThis.localStorage = working;
}

console.log(
  "peer-keys: pins go to localStorage under the package's key, every wrapper reads and writes the same store, and blocked storage does not throw",
);
