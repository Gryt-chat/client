/**
 * Where the sealed seed lives between devices: an attribute on the Keycloak
 * account. **Nothing here holds an administrator credential.**
 */

import { isSealedVault, type SealedVault } from "./identity-vault.ts";

/** Must match the attribute name in `packages/auth/bootstrap/gryt-user-profile.json`. */
export const VAULT_ATTRIBUTE = "grytMessageVault";

/**
 * A Keycloak account as the Account API hands it over. Loosely typed: a newer realm
 * must be able to add a field without this refusing to read the account.
 */
export interface AccountRepresentation {
  attributes?: Record<string, string[] | undefined>;
  [field: string]: unknown;
}

/**
 * Put the sealed blob into an account representation, keeping the rest. **The
 * Account API update replaces rather than patches**, so the caller reads first.
 */
export function withSealedVault(
  account: AccountRepresentation,
  vault: SealedVault | null,
): AccountRepresentation {
  const attributes = { ...(account.attributes ?? {}) };

  if (vault === null) {
    // An empty array rather than deleting the key: Keycloak treats an absent
    // attribute as "leave it alone" on some paths.
    attributes[VAULT_ATTRIBUTE] = [];
  } else {
    attributes[VAULT_ATTRIBUTE] = [JSON.stringify(vault)];
  }

  return { ...account, attributes };
}

/** Pull the sealed blob out of a representation, if there is one worth having. */
export function sealedVaultFrom(account: AccountRepresentation): SealedVault | null {
  const raw = account.attributes?.[VAULT_ATTRIBUTE]?.[0];
  if (typeof raw !== "string" || raw.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Something is in the attribute and it is not ours. Treated as absent rather
    // than thrown, and the next save overwrites it.
    return null;
  }

  return isSealedVault(parsed) ? parsed : null;
}

