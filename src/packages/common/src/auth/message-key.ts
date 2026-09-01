/**
 * Setting up, and using, the secret that carries your messages to a second
 * device (GRYT-783).
 *
 * `identity-vault` seals bytes and `message-vault` stores the result. This is
 * the bit in the middle that knows what is being sealed and how to put it back.
 *
 * What gets sealed is the 24-word phrase rather than the raw seed. The phrase
 * encodes the same secret, and restoring from it goes through
 * `restoreIdentityFromWords`, which already exists, already validates the
 * checksum and is already the path a guest takes. Sealing the raw bytes would
 * have meant a second way into the same store for no gain.
 */

import { listGuestScopes } from "./guest-history";
import { getIdentityWords, restoreIdentityFromWords } from "./identity-keys";
import { generateSeed, seedToWords } from "./identity-seed";
import { openSeed, type SealedVault,sealSeed } from "./identity-vault.ts";

export { describePasswordProblem, MIN_MESSAGE_PASSWORD } from "./message-password.ts";

/** Seal this device's identity under a secret, ready to be stored. */
export async function sealCurrentIdentity(
  secret: string,
  kind: "phrase" | "password",
): Promise<SealedVault> {
  const words = await getIdentityWords();
  return sealSeed(new TextEncoder().encode(words), secret, kind);
}

/**
 * Open a sealed identity and adopt it on this device.
 *
 * Everything derived from the seed follows: the per-server keys and the
 * direct-message key. Which is the whole point — after this the second device
 * is the same person, and the first one stops warning about a key it does not
 * recognise.
 */
export async function adoptSealedIdentity(
  vault: SealedVault,
  secret: string,
): Promise<void> {
  const words = new TextDecoder().decode(await openSeed(vault, secret));
  await restoreIdentityFromWords(words);
}

/**
 * How many guest identities a reset would destroy.
 *
 * A signed-in account signs with a key the Gryt CA certified, generated on its
 * own and not from the seed — so replacing the seed costs that account nothing
 * beyond its message history. A server joined *without* an account is different:
 * that key is derived from the seed (`identity-keys`, the `local` branch), so a
 * new seed is a new person there.
 *
 * `identity-keys` puts it plainly next to the derivation: it "destroys every
 * server this identity was known on — the roles, the ownership, the history —
 * permanently, silently, and with no way back". The word doing the work is
 * silently. This is what stops it being silent.
 */
export function guestIdentitiesAtRisk(): number {
  try {
    return listGuestScopes().length;
  } catch {
    // Unknown rather than none. The caller warns in general terms instead of
    // promising a number it could not read.
    return -1;
  }
}

/**
 * Start again with a new identity, sealed under a new secret.
 *
 * For somebody who has forgotten their message password. There is no way to
 * recover the old one — that is the property that makes the claim true — so the
 * only thing left is to stop carrying the loss forward.
 *
 * Everything sealed under the old seed stays sealed. This does not delete those
 * messages or repair them; it makes the *next* ones readable across devices
 * again. Callers must have said so before getting here.
 */
export async function resetMessageIdentity(secret: string): Promise<SealedVault> {
  const words = seedToWords(generateSeed());
  await restoreIdentityFromWords(words);
  return sealSeed(new TextEncoder().encode(words), secret, "password");
}
