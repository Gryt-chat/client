/**
 * Where the sealed seed lives between devices (GRYT-783), and the one piece of
 * it that can lose data.
 *
 * Deliberately free of imports that reach the app's config, so the check script
 * can load it directly. The request that uses these lives in
 * `message-vault-account`, which is four lines and needs no test to be read;
 * this is the part that would quietly unset somebody's email address.
 *
 * The blob itself is made and opened by `identity-vault`. This is only the
 * shelf it sits on: an attribute on the Keycloak account, written by its owner
 * through the Account API with their own token.
 *
 * Keycloak rather than a Gryt server, because the seed belongs to the person
 * and not to any one server. Storing it per server would hand ciphertext to
 * every operator who ever hosted them, self-hosted servers included. And
 * Keycloak rather than the identity service, because that service is stateless
 * and giving it a database to hold two hundred bytes would turn something that
 * cannot lose data into something that can.
 *
 * Nothing here holds an administrator credential. The attribute is declared
 * `edit: ["user"]`, so the only thing that can write it is the account it
 * belongs to.
 */

import { isSealedVault, type SealedVault } from "./identity-vault.ts";

/** Must match the attribute name in `packages/auth/bootstrap/gryt-user-profile.json`. */
export const VAULT_ATTRIBUTE = "grytMessageVault";

/**
 * A Keycloak account as the Account API hands it over.
 *
 * Loosely typed on purpose. The representation carries whatever the realm's
 * user profile declares, this build knows about one field of it, and a newer
 * realm must be able to add another without this refusing to read the account.
 */
export interface AccountRepresentation {
  attributes?: Record<string, string[] | undefined>;
  [field: string]: unknown;
}

/**
 * Put the sealed blob into an account representation, keeping the rest.
 *
 * Pure, and separate from the request, because this is the part that can lose
 * data. The Account API update *replaces* the representation rather than
 * patching it: posting `{ attributes: { grytMessageVault } }` on its own is a
 * request to have no email address, no username, and none of whatever else the
 * realm's profile declares. So the caller reads first, this merges, and the
 * merged object goes back.
 *
 * `null` clears the attribute — used by the reset flow, where somebody has
 * forgotten the secret and is choosing to start again.
 */
export function withSealedVault(
  account: AccountRepresentation,
  vault: SealedVault | null,
): AccountRepresentation {
  const attributes = { ...(account.attributes ?? {}) };

  if (vault === null) {
    // An empty array rather than deleting the key. Keycloak treats an absent
    // attribute as "not mentioned, leave it alone" on some paths, and the
    // point here is to say "make it gone".
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
    // Something is in the attribute and it is not ours. Treated as absent
    // rather than thrown: the person can still use this device, and the next
    // save overwrites it. Throwing here would lock them out of their own
    // account page over a field they cannot see.
    return null;
  }

  return isSealedVault(parsed) ? parsed : null;
}

