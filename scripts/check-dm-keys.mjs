/* eslint-env node */

/**
 * The DM keypair, against the real curve library (GRYT-709).
 *
 * Every property below is one the encryption rests on, and none of them fails
 * loudly on its own: a DM key that turned out to equal the identity key, or to
 * be the same on two servers, would encrypt and decrypt perfectly well and
 * quietly give away the thing it was supposed to protect. So they are asserted
 * rather than reasoned about.
 *
 * Runs against `@noble/curves` rather than a stub, because the one thing worth
 * knowing is that two people actually arrive at the same secret. Node 24 strips
 * the types on import.
 */

import assert from "node:assert/strict";

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  deriveDmKeyPair,
  dmPublicKey,
  dmSharedSecret,
} from "../src/packages/common/src/auth/dm-keys.ts";
import { deriveLocalKeyPair } from "../src/packages/common/src/auth/identity-seed.ts";

const utf8 = (s) => new TextEncoder().encode(s);
const hex = (bytes) => Buffer.from(bytes).toString("hex");

/* Two seeds that are not each other, and not a repeated byte. */
const SEED_A = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251);
const SEED_B = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 29) % 241);

/*
 * Scopes, not addresses (GRYT-719). `identityScopeFor` gives the server's
 * lineage id, so the key survives the server moving. The type checker enforces
 * that at the call site; this file is JavaScript and only cares that the
 * derivation is keyed on whatever it is handed.
 */
const HOST = "srv:one";
const OTHER_HOST = "srv:two";

/* ── deterministic, which is what makes the recovery phrase work ────────── */

{
  const first = deriveDmKeyPair(SEED_A, HOST);
  const second = deriveDmKeyPair(SEED_A, HOST);
  assert.equal(hex(first.privateKey), hex(second.privateKey),
    "the same seed and host must give the same key, or a restored identity cannot read its own messages");
  assert.equal(hex(first.publicKey), hex(second.publicKey));
  assert.equal(hex(dmPublicKey(SEED_A, HOST)), hex(first.publicKey));
}

/* ── one key per server, so two servers cannot correlate a person ───────── */

{
  const here = deriveDmKeyPair(SEED_A, HOST);
  const there = deriveDmKeyPair(SEED_A, OTHER_HOST);
  assert.notEqual(hex(here.privateKey), hex(there.privateKey),
    "one DM key across servers would undo the unlinkability identity-seed.ts is built for");
  assert.notEqual(hex(here.publicKey), hex(there.publicKey));
}

/* ── the DM key is not the identity key ─────────────────────────────────── */

{
  const dm = deriveDmKeyPair(SEED_A, HOST);
  const identity = await deriveLocalKeyPair(SEED_A, HOST);
  const jwk = await crypto.subtle.exportKey("jwk", identity.privateKey);
  const identityScalar = Buffer.from(jwk.d, "base64url");

  assert.notEqual(hex(dm.privateKey), hex(identityScalar),
    "deriving both from one label would hand the same bytes to two algorithms");

  /* And specifically: the DM key is not what the identity label produces. The
     assertion above would pass by luck if the two functions differed only in
     how they post-process the same HKDF output. */
  const identityLabelled = hkdf(sha256, SEED_A, utf8("gryt-identity-v1"), utf8(HOST), 32);
  assert.notEqual(hex(dm.privateKey), hex(identityLabelled),
    "the DM key must come from its own domain separator");
}

/* ── two people reach the same secret, which is the whole point ─────────── */

{
  const alice = deriveDmKeyPair(SEED_A, HOST);
  const bob = deriveDmKeyPair(SEED_B, HOST);
  const conversation = "dm_abc123";

  const fromAlice = dmSharedSecret(alice.privateKey, bob.publicKey, conversation);
  const fromBob = dmSharedSecret(bob.privateKey, alice.publicKey, conversation);

  assert.equal(hex(fromAlice), hex(fromBob),
    "Alice and Bob must derive the same secret or nothing decrypts");
  assert.equal(fromAlice.length, 32);
}

/* ── the same pair in a different conversation get a different key ──────── */

{
  const alice = deriveDmKeyPair(SEED_A, HOST);
  const bob = deriveDmKeyPair(SEED_B, HOST);
  const one = dmSharedSecret(alice.privateKey, bob.publicKey, "dm_one");
  const two = dmSharedSecret(alice.privateKey, bob.publicKey, "dm_two");
  assert.notEqual(hex(one), hex(two),
    "binding the conversation id in is what stops one key covering every conversation between two people");
}

/* ── a third party gets nothing ─────────────────────────────────────────── */

{
  const alice = deriveDmKeyPair(SEED_A, HOST);
  const bob = deriveDmKeyPair(SEED_B, HOST);
  const eve = deriveDmKeyPair(
    Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 61) % 239),
    HOST,
  );
  const real = dmSharedSecret(alice.privateKey, bob.publicKey, "dm_abc123");
  const eves = dmSharedSecret(eve.privateKey, alice.publicKey, "dm_abc123");
  assert.notEqual(hex(real), hex(eves));
}

/* ── a seed that cannot be right is refused ─────────────────────────────── */

{
  assert.throws(() => deriveDmKeyPair(new Uint8Array(32), HOST), /repeated byte/,
    "an all-zero seed would give every device the same key");
  assert.throws(() => deriveDmKeyPair(new Uint8Array(16), HOST), /32 bytes/);
}

console.log("dm-keys: ok");
