/**
 * Whether a cached identity certificate may still be used (GRYT-905).
 *
 * Pure and on its own, with nothing imported, so the rule can be read and
 * checked without a keychain, a network, a Keycloak session or IndexedDB. The
 * module that owns the certificate needs all four to do anything at all, which
 * is how this rule went untested long enough to ship the bug described below.
 */

/**
 * What to do with the certificate that was found in storage.
 *
 * Three ways of being unusable rather than one, because the repair differs:
 *
 * - `stale` is ours and simply old. Fetch a new one and leave the old in place
 *   until it arrives — a failed fetch on a train should not also throw away the
 *   `sub` that other code reads back out of it.
 * - `wrong-key` is ours but names a key this device no longer holds. Drop it;
 *   there is nothing in it worth keeping.
 * - `wrong-account` belongs to somebody else. Drop it *and* the keypair under
 *   it, or the next certificate binds a second account to the first one's key.
 */
export type CertificateVerdict = "use" | "stale" | "wrong-key" | "wrong-account";

export interface CachedCertificate {
  /** The `sub` inside the certificate, or null if it could not be parsed. */
  certificateSub: string | null;
  /**
   * The `sub` of the account signed in right now, or null when nothing can
   * say — signed out, session lapsed, or Keycloak unreachable.
   *
   * **Null is not a mismatch.** A laptop off the network has no answer, and
   * discarding a certificate on the strength of that would lock somebody out
   * of a server they were about to join.
   */
  signedInSub: string | null;
  /** Whether the certificate still names the keypair this device holds. */
  matchesKey: boolean;
  /** Whether it has expired, or is close enough that it should be renewed. */
  needsRenewal: boolean;
}

/**
 * The account is checked before the key, and that order is the point.
 *
 * A certificate names a `sub`, and `answer-challenge.ts` signs its assertion
 * with the one read back out of the certificate — so a certificate left behind
 * by the last account to use this device makes the next account join as them.
 * Every check the server can make passes: the key matches the certificate, the
 * certificate is in date, the CA's signature is real. The server is being told
 * the truth about somebody who is not at the keyboard.
 *
 * On 2026-09-04 a client signed in as one account joined a server as its owner,
 * who was a different account. Checking the key first would not have caught it,
 * because the key matched.
 */
export function certificateVerdict(cached: CachedCertificate): CertificateVerdict {
  if (cached.signedInSub && cached.certificateSub !== cached.signedInSub) {
    return "wrong-account";
  }
  if (cached.needsRenewal) return "stale";
  if (!cached.matchesKey) return "wrong-key";
  return "use";
}
