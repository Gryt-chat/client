/**
 * Re-sealing a version 1 bundle as version 2, at a moment the secret is in hand. The
 * old bundle stays on the account until the new one has been read back and opened.
 */

import {
  openSeed,
  type SealedVault,
  sealSeed,
  vaultNeedsUpgrade,
} from "./identity-vault.ts";

/** The account, as far as this needs it. Injected so the check script can fake it. */
export interface VaultStore {
  read(): Promise<SealedVault | null>;
  write(vault: SealedVault): Promise<void>;
}

export type UpgradeOutcome =
  /** Already current. Nothing written. */
  | "current"
  /** The account holds something else now, from another device. Nothing written. */
  | "changed"
  /** Version 2 written, read back and opened. */
  | "upgraded"
  /** Written, but it did not read back. The old bundle was put back. */
  | "restored";

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * `old` is the bundle `secret` just opened. **Never throws once the new bundle is
 * written** without having tried to put the old one back.
 */
export async function upgradeSealedVault(
  old: SealedVault,
  secret: string,
  store: VaultStore,
): Promise<UpgradeOutcome> {
  if (!vaultNeedsUpgrade(old)) return "current";

  const seed = await openSeed(old, secret);
  const next = await sealSeed(seed, { password: secret, secretKind: old.secretKind });
  if (!sameBytes(await openSeed(next, secret), seed)) {
    throw new Error("The re-sealed bundle did not open. Nothing was written.");
  }

  // A second device may have set a new password since this one read the bundle.
  // Writing over that would put back the password the person just replaced.
  const current = await store.read();
  if (!current || JSON.stringify(current) !== JSON.stringify(old)) return "changed";

  await store.write(next);

  let readable = false;
  try {
    const back = await store.read();
    readable = !!back && sameBytes(await openSeed(back, secret), seed);
  } catch {
    readable = false;
  }
  if (readable) return "upgraded";

  await store.write(old);
  return "restored";
}
