/* eslint-env node */

/**
 * Messages sealed by the WebCrypto build still open (GRYT-733).
 *
 * These bytes were produced by `message-keys.ts` and `dm-key-binding.ts` as they
 * were on main before this file existed, using `crypto.subtle`. Nothing here
 * regenerates them — that is the entire point. A conversion that quietly changed
 * the envelope would leave every message already sent unreadable, and nobody
 * finds out until they scroll back.
 *
 * If one of these fails, the format moved. Do not update a vector to make it
 * pass.
 */

import assert from "node:assert/strict";

import { verifyDmKeyBinding } from "../src/packages/common/src/auth/dm-key-binding.ts";
import { deriveDmKeyPair } from "../src/packages/common/src/auth/dm-keys.ts";
import { asIdentityScope } from "../src/packages/common/src/auth/identity-seed.ts";
import { openMessage } from "../src/packages/common/src/auth/message-keys.ts";

const SCOPE = asIdentityScope("srv:vectors");
const CONVERSATION = "dm_g0123456789abcdef0123456789abcdef";
const seed = (n) => Uint8Array.from({ length: 32 }, (_, i) => (i * n + n) % 251);

const SEALED = {"type": "gryt-sealed-message", "version": 1, "sender": "_qqFNvFDL1JRwZhMvr4hteNQerFcOMU5p2_11TQANmk", "iv": "5pNqiRGXKqEgVVN4", "body": "PNMUgOCjlqosAJkYmUGRXCmWFIfCv08qzyAfRaMBrOZBI2hQGBps1Tc2L9XagCl_RgWOvz7apC7Ef95B5IWJ", "keys": {"user_alice": {"iv": "fLtXGmKg-_zIbo2J", "key": "U8etq8cYnYV8jt-Cwhp07TYTIFi9mGxLU1wfiPTRCuCJ0eQ5jB-chZOoKRB9U4Dw"}, "user_bob": {"iv": "lsVxuR8NyXP9AdY_", "key": "4jaOCfWjO02ZG8LwcJeOEuE2gklLRb8BNzZYlXg3NKqLIyHY-EXeuPzk9OsZiYhc"}}};

const BINDING =
  "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImp3ayI6eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2IiwieCI6Il9xUkYyTzJIUGM5Yk01cXFDWVZMd3gtUkpBS0NTdnNvVDh3akdxT292SzgiLCJ5IjoiaWQyNTI4aTZTZ256RGQ5bGhJMGtMLWdBR21DT3lzbmhmR0R1bEJiWWc5TSIsImV4dCI6dHJ1ZX19.eyJpc3MiOiJncnl0OmRtLWtleSIsInNjb3BlIjoic3J2OnZlY3RvcnMiLCJkbSI6Il9xcUZOdkZETDFKUndaaE12cjRodGVOUWVyRmNPTVU1cDJfMTFUUUFObWsiLCJpYXQiOjE3NTY1MDAwMDB9.bGtdHycaMD0ZlK9H6jeeHBFs9kbS2tkk_GGL3nDq_-7zp5MCbUEPxZQnj4-ZKeP_BJhWAtThVLqeFwv7h0JFCQ";

/* ── the sender reads their own message back ────────────────────────────── */

{
  const alice = deriveDmKeyPair(seed(3), SCOPE);
  assert.equal(
    await openMessage({
      sealed: SEALED,
      conversationId: CONVERSATION,
      memberId: "user_alice",
      recipientKeys: alice,
    }),
    "vector plaintext, sealed by the WebCrypto build",
    "a message this device sealed before the change no longer opens",
  );
}

/* ── and so does the other member ───────────────────────────────────────── */

{
  const bob = deriveDmKeyPair(seed(7), SCOPE);
  assert.equal(
    await openMessage({
      sealed: SEALED,
      conversationId: CONVERSATION,
      memberId: "user_bob",
      recipientKeys: bob,
    }),
    "vector plaintext, sealed by the WebCrypto build",
    "a message somebody else sealed before the change no longer opens",
  );
}

/* ── and what we write now is still the same shape ──────────────────────── */

{
  /*
   * The other half of compatibility, and the half a vector cannot check.
   *
   * Opening reads the nonce length out of the envelope, so a change to what
   * this build *writes* leaves every vector above passing while every message
   * it sends becomes unopenable by an older client. The numbers are asserted
   * against the format rather than against a constant, so moving the constant
   * fails here.
   */
  const { sealMessage } = await import(
    "../src/packages/common/src/auth/message-keys.ts"
  );
  const alice = deriveDmKeyPair(seed(3), SCOPE);
  const bob = deriveDmKeyPair(seed(7), SCOPE);

  const fresh = await sealMessage({
    plaintext: "sealed by this build",
    conversationId: CONVERSATION,
    senderKeys: alice,
    recipients: [
      { memberId: "user_alice", publicKey: alice.publicKey },
      { memberId: "user_bob", publicKey: bob.publicKey },
    ],
  });

  assert.equal(fresh.type, SEALED.type, "the envelope's type moved");
  assert.equal(fresh.version, SEALED.version, "the envelope's version moved");
  assert.deepEqual(Object.keys(fresh).sort(), Object.keys(SEALED).sort(),
    "the envelope gained or lost a field");

  const bytes = (b64) => Buffer.from(b64, "base64url").length;

  assert.equal(bytes(fresh.iv), 12, "AES-GCM's nonce is 12 bytes; anything else is a new format");
  assert.equal(bytes(fresh.iv), bytes(SEALED.iv));
  for (const [member, wrapped] of Object.entries(fresh.keys)) {
    assert.equal(bytes(wrapped.iv), 12, `${member}'s wrapping nonce is not 12 bytes`);
    // 32-byte content key plus a 16-byte tag.
    assert.equal(bytes(wrapped.key), 48, `${member}'s wrapped key is the wrong length`);
  }

  // The tag is appended rather than carried separately, so a body is always
  // sixteen bytes longer than the message inside it.
  assert.equal(bytes(fresh.body), "sealed by this build".length + 16,
    "the authentication tag is no longer appended to the ciphertext");
}

/* ── a binding signed by WebCrypto still verifies ───────────────────────── */

{
  const verified = await verifyDmKeyBinding(BINDING, SCOPE);
  const alice = deriveDmKeyPair(seed(3), SCOPE);

  assert.equal(
    Buffer.from(verified.dmPublicKey).toString("hex"),
    Buffer.from(alice.publicKey).toString("hex"),
    "the key inside a binding signed before the change came back wrong",
  );
  assert.equal(verified.scope, SCOPE);
  assert.ok(verified.identityThumbprint.length > 0);
}

/* ── high-s signatures, which is half of them ───────────────────────────── */

{
  /*
   * The vector above happens to have a high `s`, and finding that was luck.
   * ECDSA has two valid signatures per message and WebCrypto does not normalise
   * to the low one; noble refuses the high one unless told not to. So roughly
   * half of all bindings would have failed, at random, while the other half
   * worked — which is why this signs a batch rather than trusting one sample.
   */
  const { p256 } = await import("@noble/curves/nist.js");
  const { signDmKeyBinding } = await import(
    "../src/packages/common/src/auth/dm-key-binding.ts"
  );

  const scalar = seed(5);
  const point = p256.getPublicKey(scalar, false);
  const b64u = (b) => Buffer.from(b).toString("base64url");
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: b64u(scalar),
    x: b64u(point.subarray(1, 33)),
    y: b64u(point.subarray(33, 65)),
    ext: true,
  };
  const priv = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
  const { d: _d, ...pub } = jwk;
  const alice = deriveDmKeyPair(seed(3), SCOPE);

  let high = 0;
  for (let i = 0; i < 24; i++) {
    const binding = await signDmKeyBinding({
      dmPublicKey: alice.publicKey,
      scope: SCOPE,
      identityPrivateKey: priv,
      identityPublicJwk: pub,
      now: 1756500000 + i,
    });

    const sig = Buffer.from(binding.split(".")[2], "base64url");
    const s = BigInt("0x" + sig.subarray(32).toString("hex"));
    if (s > p256.Point.Fn.ORDER / 2n) high += 1;

    await verifyDmKeyBinding(binding, SCOPE);
  }

  assert.ok(high > 0,
    "not one of 24 signatures had a high s, so this run proved nothing — rerun it");
}

/* ── and a tampered one still does not ──────────────────────────────────── */

{
  const [h, p, s] = BINDING.split(".");
  await assert.rejects(
    verifyDmKeyBinding(`${h}.${p}.${s.slice(0, -2)}AA`, SCOPE),
    /does not check out|64 bytes/,
    "the verifier stopped rejecting a broken signature",
  );
}

console.log(
  "crypto-vectors: envelopes and bindings from the WebCrypto build still open and still verify",
);
