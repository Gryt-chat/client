/**
 * The one place a server's join challenge is answered. It lived twice, and adding
 * a second kind of identity to one copy would have left the other answering old.
 */

import { getCertificateSub, getValidCertificate } from "./identity-certificate";
import { mayClaim } from "./identity-claims";
import type { IdentitySource } from "./identity-keys";
import { hasLocalIdentity, identityScopeFor, signAssertion } from "./identity-keys";
import { rememberIdentitySource } from "./identity-source";
import { getValidIdentityToken } from "./keycloak";
import { getLocalIdentity, signIdentityLink } from "./local-identity";
import { isSessionExpired } from "./session-expired";

export interface ChallengeAnswer {
  certificate: string;
  assertion: string;
  tier: "account" | "local";
  /**
   * Proof that this account is the same person who was here before without one.
   * Present only when this device already holds a local identity for the host.
   */
  link?: string;
}

/**
 * Answer a challenge from `host` with whichever identity we hold. **A token that
 * is there but whose certificate cannot be fetched fails rather than falling back**
 * — falling back would sign the assertion as somebody else.
 */
export async function answerChallenge(
  host: string,
  challenge: {
    nonce: string;
    serverHost: string;
    identityTiers?: ChallengeAnswer["tier"][];
  },
): Promise<ChallengeAnswer> {
  const accepts = (tier: ChallengeAnswer["tier"]) =>
    !challenge.identityTiers || challenge.identityTiers.includes(tier);

  // A lapsed session is deliberately not caught: falling through to the local tier
  // would answer as this device rather than as the account (GRYT-10).
  const token = accepts("account")
    ? await getValidIdentityToken().catch((e) => {
        if (isSessionExpired(e)) throw e;
        return undefined;
      })
    : undefined;

  if (token) {
    rememberIdentitySource(host, { kind: "account" });
    const certificate = await getValidCertificate();
    const sub = getCertificateSub() || "";
    const assertion = await signAssertion(
      sub,
      challenge.serverHost,
      challenge.nonce,
      { kind: "account" },
    );

    // If this device was here before without an account, say so and prove it, so
    // the server carries that membership over. Only on an explicit yes.
    let link: string | undefined;
    // Per server, and only on an explicit yes. Signing this tells the server the
    // account and the guest are one person, and nothing undoes it (GRYT-285).
    if (!mayClaim(identityScopeFor(host))) {
      return { certificate, assertion, tier: "account", link: undefined };
    }
    // Filed by scope rather than by matching an address, since GRYT-257 files
    // these under the server and a moved one would no longer match by name.
    if (await hasLocalIdentity(host).catch(() => false)) {
      link = await signIdentityLink(host, challenge.serverHost, challenge.nonce, sub)
        // A failure here costs the carry-over, not the join. Better to arrive
        // as a new member than not at all.
        .catch(() => undefined);
    }

    return { certificate, assertion, tier: "account", link };
  }

  if (!accepts("local")) {
    // Signing a certificate this server has said it will not take spends a round
    // trip, and the refusal reads like something went wrong.
    throw new Error("This server requires a Gryt account to join.");
  }

  const source: IdentitySource = { kind: "local", host };
  rememberIdentitySource(host, source);

  const { sub, certificate } = await getLocalIdentity(host);
  const assertion = await signAssertion(
    sub,
    challenge.serverHost,
    challenge.nonce,
    source,
  );
  return { certificate, assertion, tier: "local" };
}
