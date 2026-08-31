/**
 * How short a message password may be (GRYT-783).
 *
 * Its own module with no imports, so the check script can load it. That is a
 * constraint of the harness rather than a design idea — the scripts import
 * source directly and Node will not resolve a chain that reaches the app's
 * config — but it lands somewhere reasonable: the rule is a decision, and the
 * code that reads a seed out of IndexedDB is a mechanism.
 */

/**
 * How short a message password may be.
 *
 * Four, which is barely a floor at all, and that is the intention. How much
 * security somebody wants on their own messages is theirs to decide — a person
 * who wants a short password on a device only they touch is not making a
 * mistake, they are making a trade.
 *
 * There is a reason to be uneasy about it, recorded here rather than enforced:
 * the sealed blob lives in Keycloak's database and in every backup of it, so it
 * is attackable offline, in parallel, with no rate limit and nothing watching.
 * That is a worse position than a password guarded by a login form, and a short
 * one will not survive it.
 *
 * So the number is not a security control. It only catches a slip — an empty
 * box, or a stray keystroke — and the honest protection is the 24-word phrase,
 * which is what somebody who wants this to hold should use.
 */
export const MIN_MESSAGE_PASSWORD = 4;

export function describePasswordProblem(secret: string): string | null {
  if (secret.length === 0) return "Choose a password.";
  if (secret.length < MIN_MESSAGE_PASSWORD) {
    return `Use at least ${MIN_MESSAGE_PASSWORD} characters.`;
  }
  return null;
}
