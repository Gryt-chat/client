import {
  assertUsableSeed,
  SEED_BYTES,
  seedToWords,
  wordsToSeed,
} from "@gryt/crypto";

/* The 24 words, the seed length and the seed sanity check all moved to
   `@gryt/crypto` (GRYT-898). The phone had the same four, agreeing by hand.
   Re-exported so callers keep importing them from here. */
export { assertUsableSeed, SEED_BYTES, seedToWords, wordsToSeed };

/**
 * Per-server identity keys calculated from one seed (GRYT-254).
 *
 * A guest identity used to be a keypair generated at random for each server.
 * That is fine until somebody owns a second device: moving across means copying
 * every key over, and the copy is stale the moment they join somewhere new.
 *
 * One seed replaces the keyring. Each server's key is calculated from the seed
 * and that server's host, so a device holding the seed arrives at the same key
 * for a server it has never connected to. There is nothing left to sync.
 *
 * Two servers still cannot tell they are talking to the same person. HKDF's
 * output is indistinguishable from random to anyone without the seed, so the
 * derived keys look unrelated from the outside. That is what one-key-per-server
 * was bought for in the first place, and it survives the change.
 *
 * Nothing here touches storage. The seed lives in `identity-keys.ts`, which owns
 * the database — this file is only the calculation, so it can be read and
 * checked on its own.
 */
import type { IdentityScope } from "@gryt/crypto";
import { base64Url as sharedBase64Url } from "@gryt/crypto";
import { mapHashToField } from "@noble/curves/abstract/modular.js";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";



/** Length of the seed every local identity is calculated from. */

/**
 * What a per-server key is derived under, and why it is not a plain string.
 *
 * `identityScopeFor` in `identity-keys.ts` turns an address into this: the
 * server's lineage id where the server proved one, and the address only when it
 * proved nothing. GRYT-257 is the reason — an address changes when a port is
 * taken or a router hands out a new lease, and a key derived from the address
 * makes the client arrive at a server it already knows as a stranger.
 *
 * The brand lives in `@gryt/crypto` rather than here, and this file re-exports
 * it so nothing that already imports it from `@/common` has to change. It has
 * to be one declaration: a `unique symbol` brand declared twice produces two
 * types that do not assign to each other, so a second copy in the client would
 * make every scope the client mints unusable by the package's own functions.
 */
export { asIdentityScope, type IdentityScope } from "@gryt/crypto";

/**
 * Domain separator mixed into every derivation, and the reason it carries a
 * version.
 *
 * Changing this string changes every key it has ever produced, which means
 * every local identity on every server at once — new `sub`, no roles, no
 * ownership, no history. So it is versioned rather than edited: a `v2` would
 * have to arrive alongside a migration that carries identities over, not on
 * its own.
 */
const DERIVATION_SALT = "gryt-identity-v1";

/**
 * How many bytes to pull out of HKDF before reducing to a scalar.
 *
 * The order of P-256 is 32 bytes, and reducing exactly 32 bytes modulo it would
 * make the low values fractionally more likely than the high ones. Taking 16
 * bytes more than needed pushes that bias below anything measurable — the
 * "extra random bits" method from FIPS 186-4 B.4.1, which is what
 * `mapHashToField` implements.
 */
const OKM_BYTES = 48;

const ALGO: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" };

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
}

/* base64url is @gryt/crypto's (GRYT-898). */
const base64Url = sharedBase64Url;

/**
 * A fresh seed.
 *
 * `crypto.getRandomValues` and nothing else. Collisions between users do not
 * come from 256 bits being too few — they come from broken generators, which is
 * what happened to Debian's OpenSSL in 2008 and to Android's `SecureRandom` in
 * 2013. Anything derived from a timestamp, a device name or a user's input
 * would look random and would not be.
 */
export function generateSeed(): Uint8Array<ArrayBuffer> {
  const seed = new Uint8Array(SEED_BYTES);
  crypto.getRandomValues(seed);
  assertUsableSeed(seed);
  return seed as Uint8Array<ArrayBuffer>;
}

/**
 * The keypair this seed gives for one server.
 *
 * Deterministic: the same seed and scope always produce the same key, on any
 * device, whether or not that server has ever been seen before.
 *
 * Done with a curve library rather than WebCrypto because WebCrypto cannot do
 * it. It will generate a keypair for you and it will import one you already
 * have, but it will not multiply a scalar by the curve's base point, and that
 * is the step between "here are 32 derived bytes" and "here is the public half
 * that goes in the JWK".
 *
 * Extractable, like the random local keys before it, so an identity can still be
 * exported and restored.
 */
export async function deriveLocalKeyPair(
  seed: Uint8Array,
  scope: IdentityScope,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  assertUsableSeed(seed);

  const okm = hkdf(sha256, seed, utf8(DERIVATION_SALT), utf8(scope), OKM_BYTES);
  const scalar = mapHashToField(okm, p256.Point.Fn.ORDER);

  // Uncompressed, so the coordinates can be sliced straight out: a 0x04 tag,
  // then x, then y.
  const point = p256.getPublicKey(scalar, false);
  const x = base64Url(point.subarray(1, 33));
  const y = base64Url(point.subarray(33, 65));

  // `key_ops` is deliberately left off both. WebCrypto rejects an import whose
  // `key_ops` disagrees with the usages passed alongside it, and there is no
  // reason to state the same thing twice and have to keep the two in step.
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: base64Url(scalar), x, y, ext: true },
    ALGO,
    true,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, ext: true },
    ALGO,
    true,
    ["verify"],
  );

  return { privateKey, publicKey };
}
