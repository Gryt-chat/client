/**
 * The one place a server's join challenge is answered.
 *
 * This lived twice — in `joinServerOnce.ts` and in `useSocketEvents.ts` — as
 * two copies of the same four lines. Adding a second kind of identity to one
 * copy would have left the other silently answering the old way, on the path
 * that handles every reconnect.
 */

import { getCertificateSub, getValidCertificate } from "./identity-certificate";
import { listLocalIdentityHosts, signAssertion } from "./identity-keys";
import { getValidIdentityToken } from "./keycloak";
import { getLocalIdentity, signIdentityLink } from "./local-identity";

export interface ChallengeAnswer {
  certificate: string;
  assertion: string;
  tier: "account" | "local";
  /**
   * Proof that this account is the same person who was here before without
   * one. Present only when this device already holds a local identity for the
   * host — see `signIdentityLink`.
   */
  link?: string;
}

/**
 * Answer a challenge from `host` with whichever identity we hold.
 *
 * Holding a Keycloak token means the account certificate, which is what a
 * server asking for a Gryt account wants. Otherwise the host's own local key
 * vouches for itself.
 *
 * The choice is made by asking for the token rather than by being handed a
 * flag, because the token is the thing that actually decides whether an account
 * certificate can be fetched at all. A flag would have to be kept in step with
 * it from two call sites.
 *
 * Note what this does *not* do: if the token is there but the certificate
 * cannot be fetched, it fails rather than quietly falling back to a local
 * identity. Falling back would sign the assertion as somebody else — a
 * different `sub`, so a different member with different roles and history —
 * while looking to the user like a slow join.
 *
 * The server says which tiers it takes in the challenge itself, so the choice
 * is made knowing the answer rather than guessing and being refused. An older
 * server sends no list, and then we fall back to preferring the account — which
 * is what every server accepted before the tiers existed.
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

  const token = accepts("account")
    ? await getValidIdentityToken().catch(() => undefined)
    : undefined;

  if (token) {
    const certificate = await getValidCertificate();
    const sub = getCertificateSub() || "";
    const assertion = await signAssertion(
      sub,
      challenge.serverHost,
      challenge.nonce,
      { kind: "account" },
    );

    // If this device was here before without an account, say so and prove it,
    // so the server carries that membership over instead of treating a
    // returning person as a new one. Only when a key already exists — making
    // one in order to prove we hold it would prove nothing.
    let link: string | undefined;
    const localHosts = await listLocalIdentityHosts().catch((): string[] => []);
    if (localHosts.includes(host)) {
      link = await signIdentityLink(host, challenge.serverHost, challenge.nonce, sub)
        // A failure here costs the carry-over, not the join. Better to arrive
        // as a new member than not at all.
        .catch(() => undefined);
    }

    return { certificate, assertion, tier: "account", link };
  }

  if (!accepts("local")) {
    // Signing a certificate this server has already said it will not take
    // would spend a round trip to be told so, and the refusal that came back
    // would read like something went wrong rather than like an answer.
    throw new Error("This server requires a Gryt account to join.");
  }

  const { sub, certificate } = await getLocalIdentity(host);
  const assertion = await signAssertion(
    sub,
    challenge.serverHost,
    challenge.nonce,
    { kind: "local", host },
  );
  return { certificate, assertion, tier: "local" };
}
