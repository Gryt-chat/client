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
 * Not a strength meter, and not a policy anybody asked for. The blob this
 * protects sits in a database and in every backup of it, so it is the one place
 * where a four-character password is not the holder's problem alone — an
 * operator with the database can attack it offline, in parallel, with nothing
 * watching. Twelve is the same floor the account password already has.
 */
export const MIN_MESSAGE_PASSWORD = 12;

export function describePasswordProblem(secret: string): string | null {
  if (secret.length === 0) return "Choose a password.";
  if (secret.length < MIN_MESSAGE_PASSWORD) {
    return `Use at least ${MIN_MESSAGE_PASSWORD} characters.`;
  }
  return null;
}
