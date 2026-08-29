/* eslint-env node */

/**
 * Saying a DM key is yours, and refusing one that is not (GRYT-720).
 *
 * A binding that verified when it should not is a key the server chose, used to
 * encrypt everything, with a checkmark next to it. Nothing about that looks
 * wrong from the outside, so every way of getting a bad one accepted is checked
 * here rather than reasoned about.
 *
 * Against real WebCrypto, which Node 24 provides globally, and the real curve
 * library. Node strips the types on import.
 */

import assert from "node:assert/strict";

import { deriveDmKeyPair } from "../src/packages/common/src/auth/dm-keys.ts";
import {
  signDmKeyBinding,
  verifyDmKeyBinding,
} from "../src/packages/common/src/auth/dm-key-binding.ts";
import { asIdentityScope } from "../src/packages/common/src/auth/identity-seed.ts";

const SCOPE = asIdentityScope("srv:abc123");
const OTHER_SCOPE = asIdentityScope("srv:def456");

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

const alice = await identity();
const mallory = await identity();
const aliceDm = deriveDmKeyPair(seed(7), SCOPE);

const sign = async (over = {}) =>
  signDmKeyBinding({
    dmPublicKey: aliceDm.publicKey,
    scope: SCOPE,
    identityPrivateKey: alice.privateKey,
    identityPublicJwk: alice.publicJwk,
    ...over,
  });

const hex = (b) => Buffer.from(b).toString("hex");
const parts = (jwt) => jwt.split(".");
const decode = (p) => JSON.parse(Buffer.from(p, "base64url").toString());
const encode = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/* ── a binding you signed yourself comes back with the key you put in ────── */

{
  const binding = await sign();
  const verified = await verifyDmKeyBinding(binding, SCOPE);

  assert.equal(hex(verified.dmPublicKey), hex(aliceDm.publicKey),
    "the key that comes back out has to be the key that went in");
  assert.equal(verified.scope, SCOPE);
  assert.equal(typeof verified.identityThumbprint, "string");
  assert.ok(verified.identityThumbprint.length > 0,
    "the thumbprint is the thing a caller pins, so it cannot be empty");
  assert.equal(typeof verified.signedAt, "number");
}

/* ── two identities give two thumbprints ────────────────────────────────── */

{
  const mine = await verifyDmKeyBinding(await sign(), SCOPE);
  const theirs = await verifyDmKeyBinding(
    await signDmKeyBinding({
      dmPublicKey: aliceDm.publicKey,
      scope: SCOPE,
      identityPrivateKey: mallory.privateKey,
      identityPublicJwk: mallory.publicJwk,
    }),
    SCOPE,
  );

  // Mallory can sign a binding over Alice's public key — it is public. What she
  // cannot do is make it come back under Alice's thumbprint, which is the only
  // thing a pin is ever compared against.
  assert.notEqual(mine.identityThumbprint, theirs.identityThumbprint,
    "a binding signed by somebody else must not verify under the first thumbprint");
}

/* ── replay from another server ─────────────────────────────────────────── */

{
  const binding = await sign();
  await assert.rejects(
    verifyDmKeyBinding(binding, OTHER_SCOPE),
    /different server/,
    "a binding is valid on its own server and must not be usable on another",
  );
}

/* ── tampering ──────────────────────────────────────────────────────────── */

{
  const binding = await sign();
  const [h, p, s] = parts(binding);

  // A different DM key, same signature.
  const swapped = decode(p);
  swapped.dm = Buffer.from(deriveDmKeyPair(seed(11), SCOPE).publicKey).toString("base64url");
  await assert.rejects(
    verifyDmKeyBinding(`${h}.${encode(swapped)}.${s}`, SCOPE),
    /does not check out/,
    "the DM key was replaced and the signature still passed",
  );

  // A different signing key in the header, original signature.
  const other = decode(h);
  other.jwk = mallory.publicJwk;
  await assert.rejects(
    verifyDmKeyBinding(`${encode(other)}.${p}.${s}`, SCOPE),
    /does not check out/,
    "the header key was replaced and the signature still passed",
  );

  await assert.rejects(verifyDmKeyBinding(`${h}.${p}.`, SCOPE),
    /does not check out|three parts|64 bytes/, "an empty signature passed");
}

/* ── the JWT mistakes, which are the ones with names ────────────────────── */

{
  const binding = await sign();
  const [h, p, s] = parts(binding);

  for (const alg of ["none", "HS256", "ES384"]) {
    const header = { ...decode(h), alg };
    await assert.rejects(
      verifyDmKeyBinding(`${encode(header)}.${p}.${s}`, SCOPE),
      /ES256/,
      `alg: "${alg}" was taken from the header instead of being pinned`,
    );
  }

  const noKey = { ...decode(h) };
  delete noKey.jwk;
  await assert.rejects(verifyDmKeyBinding(`${encode(noKey)}.${p}.${s}`, SCOPE),
    /no key to check it with/, "a binding with no key in it was accepted");

  const wrongIssuer = { ...decode(p), iss: "gryt:self" };
  await assert.rejects(
    verifyDmKeyBinding(`${h}.${encode(wrongIssuer)}.${s}`, SCOPE),
    /issued by/,
    "a JWT from another path was read as a DM key binding",
  );
}

/* ── shapes that are not a binding at all ───────────────────────────────── */

{
  for (const bad of ["", "one.two", "a.b.c.d", "not a jwt"]) {
    await assert.rejects(verifyDmKeyBinding(bad, SCOPE), undefined,
      `"${bad}" was accepted as a binding`);
  }

  /*
   * Signed properly, over a key of the wrong length. Editing the payload of a
   * good binding does not test this — it breaks the signature, so verification
   * fails a step earlier and the length check is never reached. This one has to
   * survive every other check and be refused on its size.
   */
  for (const size of [16, 31, 33, 64]) {
    const wrongSize = await sign({ dmPublicKey: new Uint8Array(size).fill(3) });
    await assert.rejects(
      verifyDmKeyBinding(wrongSize, SCOPE),
      /32 bytes/,
      `a validly signed binding over a ${size}-byte key was accepted`,
    );
  }
}

console.log(
  "dm-key-binding: the key survives the round trip, and a replayed, re-signed, re-keyed or re-algorithmed one does not",
);
