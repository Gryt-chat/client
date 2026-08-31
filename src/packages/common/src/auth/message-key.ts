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

import { getIdentityWords, restoreIdentityFromWords } from "./identity-keys";
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
