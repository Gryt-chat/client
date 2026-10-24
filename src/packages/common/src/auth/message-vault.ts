/**
 * The old password-locked copy of the key on the Keycloak account, now only found and cleared
 * (GRYT-1882). **Nothing here holds an administrator credential.**
 */

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

/** Whether the account still holds a copy, in any version. */
export function hasVault(account: AccountRepresentation): boolean {
  const raw = account.attributes?.[VAULT_ATTRIBUTE]?.[0];
  return typeof raw === "string" && raw.length > 0;
}

/**
 * The account with the copy cleared and everything else kept. **The Account API update
 * replaces rather than patches**, so the caller reads first.
 */
export function withoutVault(account: AccountRepresentation): AccountRepresentation {
  // An empty array rather than deleting the key: Keycloak treats an absent attribute as "leave it alone".
  return { ...account, attributes: { ...(account.attributes ?? {}), [VAULT_ATTRIBUTE]: [] } };
}
