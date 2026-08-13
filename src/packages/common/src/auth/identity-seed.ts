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

import { mapHashToField } from "@noble/curves/abstract/modular.js";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** Length of the seed every local identity is calculated from. */
export const SEED_BYTES = 32;

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

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Reject a seed that is obviously not random.
 *
 * This cannot detect a generator that is subtly weak, and it is not trying to.
 * What it catches is the loud version — a stub, a mock left in by accident, or
 * a platform returning a constant — where every device would derive the same
 * keys and every user would silently be the same person. A real seed being all
 * one byte has a probability of about 2^-248, so there is no honest case to
 * lose here.
 */
function assertUsableSeed(seed: Uint8Array): void {
  if (seed.length !== SEED_BYTES) {
    throw new Error(
      `Identity seed must be ${SEED_BYTES} bytes, got ${seed.length}`,
    );
  }
  if (seed.every((b) => b === seed[0])) {
    throw new Error("Identity seed is a repeated byte — refusing to use it");
  }
}

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
 * Deterministic: the same seed and host always produce the same key, on any
 * device, whether or not that host has ever been seen before.
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
  host: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  assertUsableSeed(seed);

  const okm = hkdf(sha256, seed, utf8(DERIVATION_SALT), utf8(host), OKM_BYTES);
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
