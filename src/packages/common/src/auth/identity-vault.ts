/**
 * The seed, sealed under something only its owner knows, so a second device can be
 * handed it. **Not derived from the account id, and not escrow** (GRYT-783).
 */

// The explicit .ts extension is load-bearing: the check script imports this
// directly, and Node's resolver will not guess an extension.
import {
  base64Url,
  deriveWrappingKey,
  freshNonces,
  fromBase64Url,
  PBKDF2_ITERATIONS,
} from "./passphrase-crypto.ts";

export const VAULT_TYPE = "gryt-identity-vault";
export const VAULT_VERSION = 1;

/** How the secret was chosen, which decides what the recovery story is. */
export type VaultSecretKind = "phrase" | "password";

export interface SealedVault {
  type: typeof VAULT_TYPE;
  version: number;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  /** How the secret was chosen. Presentation only — never mixed into the key. */
  secretKind: VaultSecretKind;
  salt: string;
  iv: string;
  data: string;
}

/**
 * What the ciphertext is bound to, so it can only be opened as what it is. Passed
 * as AES-GCM additional data, and the version is in it too.
 */
function associatedData(version: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${VAULT_TYPE}:v${version}`) as Uint8Array<ArrayBuffer>;
}

/** Whether a blob is one of these, so a caller knows what to ask for. */
export function isSealedVault(value: unknown): value is SealedVault {
  const v = value as Partial<SealedVault> | null;
  return !!v && v.type === VAULT_TYPE && typeof v.salt === "string" && typeof v.data === "string";
}

/**
 * Seal a seed under a secret. `secretKind` is recorded so the prompt on the other
 * device can ask for the right thing. **It is not part of the derivation.**
 */
export async function sealSeed(
  seed: Uint8Array,
  secret: string,
  secretKind: VaultSecretKind,
): Promise<SealedVault> {
  if (!secret) throw new Error("Choose a secret before sealing the seed.");
  if (seed.length === 0) throw new Error("There is no seed to seal.");

  const { salt, iv } = freshNonces();
  const key = await deriveWrappingKey(secret, salt, PBKDF2_ITERATIONS);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(VAULT_VERSION) },
    key,
    seed as Uint8Array<ArrayBuffer>,
  );

  return {
    type: VAULT_TYPE,
    version: VAULT_VERSION,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    secretKind,
    salt: base64Url(salt),
    iv: base64Url(iv),
    data: base64Url(new Uint8Array(data)),
  };
}

/** Open one. Throws if the secret is wrong or the blob has been altered. */
export async function openSeed(vault: unknown, secret: string): Promise<Uint8Array> {
  if (!isSealedVault(vault)) {
    throw new Error("That is not a sealed Gryt identity.");
  }
  if (vault.version !== VAULT_VERSION) {
    // Refused rather than attempted. A newer blob may mean something different
    // by the same fields, and guessing at it is how a format becomes unsafe.
    throw new Error("This sealed identity was written by a newer version of Gryt.");
  }

  const key = await deriveWrappingKey(
    secret,
    fromBase64Url(vault.salt),
    // Read from the blob rather than assumed, so one sealed under a different
    // setting still opens.
    typeof vault.iterations === "number" ? vault.iterations : PBKDF2_ITERATIONS,
  );

  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64Url(vault.iv),
        additionalData: associatedData(vault.version),
      },
      key,
      fromBase64Url(vault.data),
    );
    return new Uint8Array(plain);
  } catch {
    // AES-GCM fails the same way for a wrong secret and a tampered blob. The wrong
    // secret is overwhelmingly the likely one, so it leads.
    throw new Error("Wrong secret, or this sealed identity has been altered.");
  }
}
