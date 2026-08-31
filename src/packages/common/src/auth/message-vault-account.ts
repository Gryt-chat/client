/**
 * Reading and writing the sealed seed on the Keycloak account (GRYT-783).
 *
 * The merge lives in `message-vault` and is tested there. This is only the
 * request around it, kept apart so that the part which can lose data has no
 * dependency on the app's configuration and can be loaded on its own.
 */

import { getAccountRepresentation, putAccountRepresentation } from "./account-api.ts";
import type { SealedVault } from "./identity-vault.ts";
import { type AccountRepresentation,sealedVaultFrom, withSealedVault } from "./message-vault.ts";

/** The sealed seed on this account, or null if it has never been set. */
export async function readSealedVault(): Promise<SealedVault | null> {
  return sealedVaultFrom((await getAccountRepresentation()) as AccountRepresentation);
}

/**
 * Store the sealed seed, or clear it with `null`.
 *
 * Read-modify-write, for the reason in `withSealedVault`. The read is not
 * cached: two devices can be signed in, and writing a stale representation
 * would revert whatever the other one changed.
 */
export async function writeSealedVault(vault: SealedVault | null): Promise<void> {
  const account = (await getAccountRepresentation()) as AccountRepresentation;
  await putAccountRepresentation(withSealedVault(account, vault) as Record<string, unknown>);
}
