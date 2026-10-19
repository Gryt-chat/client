/**
 * The half of pinning that is this client's: the store and its wrappers. The
 * assertions go through raw `localStorage`, because both failures are silent.
 */

import assert from "node:assert/strict";

import { deriveDmKeyPair,PEER_PINS_KEY, signDmKeyBinding } from "@gryt/crypto";

import { asIdentityScope } from "../src/packages/common/src/auth/identity-seed.ts";

const backing = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k: string, v: string) => backing.set(k, String(v)),
    removeItem: (k: string) => backing.delete(k),
    clear: () => backing.clear(),
  },
});

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
type PeerPin = NonNullable<ReturnType<typeof getPeerPin>>;

const SCOPE = asIdentityScope("srv:abc123");
const OTHER_SCOPE = asIdentityScope("srv:def456");
const BOB = "user_bob";

const seed = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => (i * n + n) % 251);

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
const stored = (): Record<string, PeerPin> => JSON.parse(localStorage.getItem(PEER_PINS_KEY) ?? "{}");

/* ── a pin lands in localStorage, under the key the package names ───────── */

{
  const binding = await bind();
  const first = await evaluatePeerKey({ scope: SCOPE, memberId: BOB, binding });
  assert.ok(first.kind === "first", `the first look came back as ${first.kind}`);
  assert.equal(localStorage.getItem(PEER_PINS_KEY), null,
    "evaluating must not write; the caller decides when to pin");

  pinPeerKey(SCOPE, BOB, first.verified);

  const raw = stored();
  assert.equal(Object.keys(raw).length, 1, "the pin has to reach storage");
  assert.equal(Object.values(raw)[0]?.thumbprint, first.verified.identityThumbprint);

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
  // A reload is only this: the module's memory is gone and localStorage is not.
  // Faked by writing the map directly and reading it back through the module.
  const raw = stored();
  const key = Object.keys(raw)[0];
  backing.set(PEER_PINS_KEY, JSON.stringify({
    ...raw,
    [key]: { ...raw[key], comparedAt: 1234 },
  }));

  assert.equal(getPeerPin(SCOPE, BOB)?.comparedAt, 1234,
    "a pin has to be read from storage every time, not cached at import");
}

/* ── every wrapper passes the store, not just the ones read so far ──────── */

{
  const pin = getPeerPin(SCOPE, BOB);
  assert.ok(pin, "Bob's pin is gone");
  assert.equal(markPeerCompared(SCOPE, BOB, {
    thumbprint: pin.thumbprint,
    dmPublicKey: pin.dmPublicKey,
  }, 5678), true);
  assert.equal(stored()[Object.keys(stored())[0]].comparedAt, 5678,
    "markPeerCompared has to write through to storage");

  const other = await bind({ scope: OTHER_SCOPE });
  const there = await evaluatePeerKey({ scope: OTHER_SCOPE, memberId: BOB, binding: other });
  assert.ok(there.kind === "first", `the other scope's first look came back as ${there.kind}`);
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
  Object.assign(globalThis, {
    localStorage: {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("full"); },
    },
  });

  assert.deepEqual(localPeerPinStore.read(), {},
    "an unreadable store reads as empty rather than throwing into a member list");
  // @ts-expect-error -- not a pin, on purpose; the store has to survive writing it.
  localPeerPinStore.write({ a: 1 });

  const binding = await bind();
  assert.equal((await evaluatePeerKey({ scope: SCOPE, memberId: BOB, binding })).kind,
    "first", "a decision still comes back when storage is gone");

  Object.assign(globalThis, { localStorage: working });
}

console.log(
  "peer-keys: pins go to localStorage under the package's key, every wrapper reads and writes the same store, and blocked storage does not throw",
);
