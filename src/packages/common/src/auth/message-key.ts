/**
 * Setting up, and using, the secret that carries your messages to a second device.
 * What gets sealed is the 24-word phrase rather than the raw seed (GRYT-783).
 */

import { guestScopeRisk } from "./guest-history.ts";
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
 * Open a sealed identity and adopt it on this device. Everything derived from the
 * seed follows, which is the point: the second device is the same person.
 */
export async function adoptSealedIdentity(
  vault: SealedVault,
  secret: string,
): Promise<void> {
  const words = new TextDecoder().decode(await openSeed(vault, secret));
  await restoreIdentityFromWords(words);
}

/**
 * What a reset destroys on servers joined without an account: those keys derive
 * from the seed. **`certain` is false when the store is unreadable or empty.**
 */
export function guestIdentitiesAtRisk(): { count: number; certain: boolean } {
  try {
    return guestScopeRisk();
  } catch {
    // Belt and braces: anything `guestScopeRisk` did not expect lands here and is
    // reported as uncertain, never as a confident zero.
    return { count: 0, certain: false };
  }
}

/**
 * Start again with a new identity, sealed under a new secret, for somebody who has
 * forgotten their password. Everything sealed under the old seed stays sealed.
 */
export async function resetMessageIdentity(secret: string): Promise<SealedVault> {
  const words = seedToWords(generateSeed());
  await restoreIdentityFromWords(words);
  return sealSeed(new TextEncoder().encode(words), secret, "password");
}
