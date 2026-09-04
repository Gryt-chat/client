import { base64UrlDecode } from "@gryt/crypto";
/**
 * Turning a passphrase somebody chose into a key, and the encoding around it.
 *
 * Extracted from `identity-backup-lock`, which had all of this to itself until
 * a second caller appeared (`identity-vault`). One implementation rather than
 * two on purpose: both of them protect the same secret, and two copies of a
 * key derivation drift the way two copies of anything drift — quietly, and in
 * the direction of the one nobody looked at.
 */

/**
 * PBKDF2 rather than Argon2, which would resist a cracking rig better.
 *
 * The trade bought is a dependency: PBKDF2 is in WebCrypto already, and this
 * ships in a client where the alternative is another package on the critical
 * path of somebody's identity. 600k iterations of SHA-256 is the current OWASP
 * figure. `iterations` is recorded in whatever this protects, so raising it
 * later does not strand anything written today.
 */
export const PBKDF2_ITERATIONS = 600_000;

export const SALT_BYTES = 16;
export const IV_BYTES = 12;

/* base64url comes from @gryt/crypto now (GRYT-898). The three copies this file
   and its neighbours carried were all the same `btoa` pair that package was
   written to replace — see its `base64.ts` header for why `btoa` is the wrong
   one to standardise on. Re-exported so callers do not have to move. */
export { base64Url } from "@gryt/crypto";

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  return base64UrlDecode(value) as Uint8Array<ArrayBuffer>;
}

export async function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase) as Uint8Array<ArrayBuffer>,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** A fresh salt and IV, for one thing being sealed once. */
export function freshNonces(): { salt: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer> } {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  return { salt: salt as Uint8Array<ArrayBuffer>, iv: iv as Uint8Array<ArrayBuffer> };
}
