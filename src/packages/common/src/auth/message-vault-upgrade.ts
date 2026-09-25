/**
 * Re-sealing the bundle: a version 1 one when its secret is in hand, or under a new
 * password from a device that holds the seed. The old one stays until the new one opens.
 */

import { formatRecoveryKey } from "@gryt/crypto/recovery-key";

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

/** `old` is the bundle `secret` just opened. */
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

  return writeKeepingOld(old, next, secret, seed, store, "upgraded");
}

export type ResealOutcome = "changed" | "resealed" | "restored";

/**
 * Seal this device's `seed` under a new password without the old one (decision 3). A
 * fresh content key, so a recovery key made before stops opening it.
 */
export async function resealFromThisDevice(
  old: SealedVault,
  seed: Uint8Array,
  { password, recoveryKey }: { password: string; recoveryKey?: Uint8Array },
  store: VaultStore,
): Promise<ResealOutcome> {
  const next = await sealSeed(seed, { password, secretKind: "password", recoveryKey });
  const opens = async (secret: string) => sameBytes(await openSeed(next, secret), seed);
  if (!(await opens(password)) || (recoveryKey && !(await opens(formatRecoveryKey(recoveryKey))))) {
    throw new Error("The re-sealed bundle did not open. Nothing was written.");
  }
  return writeKeepingOld(old, next, password, seed, store, "resealed");
}

/** **Never throws once `next` is written** without having tried to put `old` back. */
async function writeKeepingOld<T extends string>(
  old: SealedVault,
  next: SealedVault,
  secret: string,
  seed: Uint8Array,
  store: VaultStore,
  written: T,
): Promise<T | "changed" | "restored"> {
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
  if (readable) return written;

  await store.write(old);
  return "restored";
}
