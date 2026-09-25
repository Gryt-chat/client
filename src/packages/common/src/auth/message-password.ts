/**
 * The floor on a message password somebody types. Six generated words are the default
 * and clear it; this is for the typed one (GRYT-1473).
 */
import { MIN_VAULT_PASSWORD } from "@gryt/crypto/vault-password";

export { generateVaultPassword, MIN_VAULT_PASSWORD } from "@gryt/crypto/vault-password";

/**
 * Enforced where a password is chosen, not where one is opened: a bundle sealed under
 * the old floor of four still has to open and re-seal.
 */
export function describePasswordProblem(secret: string): string | null {
  if (secret.length === 0) return "Choose a password.";
  // Characters, not bytes and not UTF-16 units, so an emoji counts as one.
  if ([...secret].length < MIN_VAULT_PASSWORD) {
    return `Use at least ${MIN_VAULT_PASSWORD} characters, or the six generated words.`;
  }
  return null;
}
