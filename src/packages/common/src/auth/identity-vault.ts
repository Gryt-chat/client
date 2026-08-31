/**
 * The seed, sealed under something only its owner knows, so it can be handed
 * back on a second device (GRYT-783).
 *
 * The problem this solves: `getOrCreateSeed` makes a fresh seed whenever a
 * device has none. Every per-server key derives from that seed and so does the
 * direct-message key, so signing in somewhere new produces a different message
 * identity, publishes it over the first one, and the first device then says
 * "this server is showing a message key that is not yours" — a warning about a
 * hostile server, raised by your own laptop.
 *
 * What is deliberately *not* changed: encryption stays automatic. Nobody sets
 * anything up to have their messages sealed, and nobody has to. Only carrying
 * the seed to a second device costs a secret, and it is asked for at the moment
 * somebody adds one, when the reason is obvious — not at sign-up, when it is
 * not.
 *
 * The sealed blob is meant to be stored server-side and handed back after
 * authentication, so the server holds bytes it cannot open. That is the whole
 * point, and it is also why this file is worth reading closely: if the wrapping
 * is weak, the ciphertext is not worth storing.
 *
 * Two things this is not:
 *
 * - **Not derived from the account id.** `gryt_user_id` is the Keycloak `sub`,
 *   and it is stored in the `users` table of every server the person has ever
 *   joined, including self-hosted ones run by strangers. Deriving key material
 *   from it would let each of those operators read the messages, retroactively
 *   and undetectably.
 * - **Not escrow.** Nobody but the holder of the secret can open this. That is
 *   the property that makes the Privacy Policy true, and it is why forgetting
 *   the secret costs the old messages rather than costing nothing.
 */

// The explicit .ts extension is load-bearing rather than a style choice. The
// check script imports this module directly and Node strips the types on the
// way in, and Node's resolver will not guess an extension — so an extensionless
// specifier here makes this file untestable without a bundler. tsconfig.app has
// allowImportingTsExtensions with noEmit, so tsc and Vite are both happy.
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
 * What the ciphertext is bound to, so it can only be opened as what it is.
 *
 * Passed as AES-GCM additional data, which is authenticated but not encrypted:
 * unwrapping with different associated data fails the tag check. Without it a
 * blob from `identity-backup-lock` and a blob from here are the same shape
 * sealed the same way, and the only thing keeping them apart is that nobody
 * thought to try. The version is in here too, so a future format cannot be
 * opened by a reader that would misinterpret it.
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
 * Seal a seed under a secret.
 *
 * `secretKind` is recorded so the prompt on the other device can say the right
 * thing — asking for 24 words when a password was set is a dead end for
 * somebody who no longer remembers which they chose. It is not part of the
 * derivation: it describes the secret, and a value the server can see must
 * never change what the key is.
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
    // AES-GCM fails the same way for a wrong secret and for a tampered blob,
    // and there is no way to tell them apart from here. The wrong secret is
    // overwhelmingly the likely one, so it leads.
    throw new Error("Wrong secret, or this sealed identity has been altered.");
  }
}
