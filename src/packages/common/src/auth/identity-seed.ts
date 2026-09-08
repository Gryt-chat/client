import {
  assertUsableSeed,
  SEED_BYTES,
  seedToWords,
  wordsToSeed,
} from "@gryt/crypto";

/* The 24 words, the seed length and the seed sanity check moved to `@gryt/crypto`,
   where the phone shares them. Re-exported so callers keep importing from here. */
export { assertUsableSeed, SEED_BYTES, seedToWords, wordsToSeed };

/**
 * Per-server identity keys derived from one seed. **Two servers still cannot tell
 * they are talking to the same person**, and **nothing here touches storage**.
 */
import type { IdentityScope } from "@gryt/crypto";
import { base64Url as sharedBase64Url } from "@gryt/crypto";
import { mapHashToField } from "@noble/curves/abstract/modular.js";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";



/** Length of the seed every local identity is calculated from. */

/**
 * What a per-server key is derived under: the server's lineage id, or the address
 * only when the server proved nothing. **The brand is one declaration** (GRYT-257).
 */
export { asIdentityScope, type IdentityScope } from "@gryt/crypto";

/**
 * Domain separator mixed into every derivation. **Changing this string changes
 * every key it has ever produced**, so it is versioned rather than edited.
 */
const DERIVATION_SALT = "gryt-identity-v1";

/**
 * How many bytes to pull out of HKDF before reducing to a scalar. 16 more than the
 * order needs, which is FIPS 186-4 B.4.1's extra-random-bits method.
 */
const OKM_BYTES = 48;

const ALGO: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" };

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
}

/* base64url is @gryt/crypto's (GRYT-898). */
const base64Url = sharedBase64Url;

/**
 * A fresh seed, from `crypto.getRandomValues` and nothing else. Collisions come
 * from broken generators, not from 256 bits being too few.
 */
export function generateSeed(): Uint8Array<ArrayBuffer> {
  const seed = new Uint8Array(SEED_BYTES);
  crypto.getRandomValues(seed);
  assertUsableSeed(seed);
  return seed as Uint8Array<ArrayBuffer>;
}

/**
 * The keypair this seed gives for one server. A curve library rather than
 * WebCrypto, which will not multiply a scalar by the base point. Extractable.
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

  // `key_ops` is deliberately left off both: WebCrypto rejects an import whose
  // `key_ops` disagrees with the usages passed alongside it.
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
