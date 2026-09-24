/**
 * Setting up, and using, the secret that carries your messages to a second device.
 * What gets sealed is the 24-word phrase rather than the raw seed (GRYT-783).
 */

import { guestScopeRisk } from "./guest-history.ts";
import { getIdentityWords, restoreIdentityFromWords } from "./identity-keys";
import { generateSeed, seedToWords } from "./identity-seed";
import { openSeed, type SealedVault, type SealedVaultV2, sealSeed } from "./identity-vault.ts";
import { readSealedVault, writeSealedVault } from "./message-vault-account.ts";
import { type UpgradeOutcome,upgradeSealedVault } from "./message-vault-upgrade.ts";

export { describePasswordProblem, generateVaultPassword, MIN_VAULT_PASSWORD } from "./message-password.ts";
export { formatRecoveryKey, generateRecoveryKey } from "@gryt/crypto/recovery-key";

/**
 * Seal this device's identity under a password, and a recovery key if one was taken.
 * Always version 2, so a new or changed password never sees PBKDF2.
 */
export async function sealCurrentIdentity(
  password: string,
  recoveryKey?: Uint8Array,
): Promise<SealedVaultV2> {
  const words = await getIdentityWords();
  return sealSeed(new TextEncoder().encode(words), { password, secretKind: "password", recoveryKey });
}

/**
 * Open a sealed identity and adopt it on this device. Everything derived from the
 * seed follows, which is the point: the second device is the same person.
 */
export async function adoptSealedIdentity(
  vault: SealedVault,
  secret: string,
): Promise<UpgradeOutcome | "failed"> {
  const words = new TextDecoder().decode(await openSeed(vault, secret));
  await restoreIdentityFromWords(words);

  // The secret is in hand, which is the only time an old bundle can be re-sealed.
  // Best effort: adopting has already worked, and the old bundle still opens.
  try {
    return await upgradeSealedVault(vault, secret, { read: readSealedVault, write: writeSealedVault });
  } catch (e) {
    console.warn("[MessageKey] Could not upgrade the sealed bundle:", e);
    return "failed";
  }
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
export async function resetMessageIdentity(
  password: string,
  recoveryKey?: Uint8Array,
): Promise<SealedVaultV2> {
  const words = seedToWords(generateSeed());
  await restoreIdentityFromWords(words);
  return sealSeed(new TextEncoder().encode(words), { password, secretKind: "password", recoveryKey });
}
