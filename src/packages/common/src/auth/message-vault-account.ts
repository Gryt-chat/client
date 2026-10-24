/**
 * Reading and clearing the old copy on the Keycloak account. The logic lives in
 * `message-vault` and is tested there; this is only the request around it.
 */

import { getAccountRepresentation, putAccountRepresentation } from "./account-api.ts";
import { type AccountRepresentation, hasVault, withoutVault } from "./message-vault.ts";

export async function hasAccountVault(): Promise<boolean> {
  return hasVault((await getAccountRepresentation()) as AccountRepresentation);
}

/** Read-modify-write, and the read is not cached: two devices can be signed in. */
export async function clearAccountVault(): Promise<void> {
  const account = (await getAccountRepresentation()) as AccountRepresentation;
  await putAccountRepresentation(withoutVault(account) as Record<string, unknown>);
}
