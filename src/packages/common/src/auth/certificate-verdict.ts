/**
 * Whether a cached identity certificate may still be used. Pure and importing
 * nothing, so the rule can be checked without a keychain or a session (GRYT-905).
 */

/**
 * What to do with the certificate found in storage. Three ways of being unusable,
 * because the repair differs — `wrong-account` has to drop the keypair too.
 */
export type CertificateVerdict = "use" | "stale" | "wrong-key" | "wrong-account";

export interface CachedCertificate {
  /** The `sub` inside the certificate, or null if it could not be parsed. */
  certificateSub: string | null;
  /**
   * The `sub` of the account signed in right now, or null when nothing can say.
   * **Null is not a mismatch** — a laptop off the network has no answer.
   */
  signedInSub: string | null;
  /** Whether the certificate still names the keypair this device holds. */
  matchesKey: boolean;
  /** Whether it has expired, or is close enough that it should be renewed. */
  needsRenewal: boolean;
}

/**
 * The account is checked before the key, and that order is the point: a
 * certificate left behind by the last account makes the next one join as them.
 */
export function certificateVerdict(cached: CachedCertificate): CertificateVerdict {
  if (cached.signedInSub && cached.certificateSub !== cached.signedInSub) {
    return "wrong-account";
  }
  if (cached.needsRenewal) return "stale";
  if (!cached.matchesKey) return "wrong-key";
  return "use";
}
