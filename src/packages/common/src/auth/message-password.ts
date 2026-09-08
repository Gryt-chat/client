/**
 * How short a message password may be. Its own module with no imports, so the
 * check script can load it.
 */

/**
 * How short a message password may be. **Four is not a security control** — the
 * sealed blob is attackable offline, and the 24-word phrase is the protection.
 */
export const MIN_MESSAGE_PASSWORD = 4;

export function describePasswordProblem(secret: string): string | null {
  if (secret.length === 0) return "Choose a password.";
  if (secret.length < MIN_MESSAGE_PASSWORD) {
    return `Use at least ${MIN_MESSAGE_PASSWORD} characters.`;
  }
  return null;
}
