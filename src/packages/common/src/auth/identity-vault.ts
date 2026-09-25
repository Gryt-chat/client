/**
 * The seed, sealed under something only its owner knows, so a second device can be
 * handed it. The format is `@gryt/crypto`'s; this binds it to the web KDFs (GRYT-1473).
 */
import {
  openSeed as openWith,
  type SealedVaultV2,
  sealSeed as sealWith,
  type SealSeedOptions,
} from "@gryt/crypto/identity-vault";

// The explicit .ts extension is load-bearing: the check script imports this
// directly, and Node's resolver will not guess an extension.
import { webVaultKdfs } from "./vault-kdfs.ts";

export {
  isSealedVault,
  type SealedVault,
  type SealedVaultV2,
  VAULT_TYPE,
  VAULT_VERSION,
  vaultHasRecoverySlot,
  vaultNeedsUpgrade,
  type VaultSecretKind,
} from "@gryt/crypto/identity-vault";

export function sealSeed(seed: Uint8Array, options: SealSeedOptions): Promise<SealedVaultV2> {
  return sealWith(seed, options, webVaultKdfs);
}

/** Takes the password, or the recovery key typed into the same field. */
export function openSeed(vault: unknown, secret: string): Promise<Uint8Array> {
  return openWith(vault, secret, webVaultKdfs);
}
