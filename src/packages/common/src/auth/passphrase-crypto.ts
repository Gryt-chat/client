import { base64UrlDecode } from "@gryt/crypto";
/**
 * Turning a passphrase somebody chose into a key, and the encoding around it. One
 * implementation, because two copies of a key derivation drift quietly.
 */

/**
 * PBKDF2 rather than Argon2, which would resist a cracking rig better: PBKDF2 is in
 * WebCrypto already. `iterations` is recorded, so raising it strands nothing.
 */
export const PBKDF2_ITERATIONS = 600_000;

export const SALT_BYTES = 16;
export const IV_BYTES = 12;

/* base64url comes from @gryt/crypto now. The three copies here were the same
   `btoa` pair that package replaced. Re-exported so callers do not move. */
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
