/**
 * The one place a server's join challenge is answered.
 *
 * This lived twice — in `joinServerOnce.ts` and in `useSocketEvents.ts` — as
 * two copies of the same four lines. Adding a second kind of identity to one
 * copy would have left the other silently answering the old way, on the path
 * that handles every reconnect.
 */

import { getCertificateSub, getValidCertificate } from "./identity-certificate";
import { signAssertion } from "./identity-keys";
import { getValidIdentityToken } from "./keycloak";
import { getLocalIdentity } from "./local-identity";

export interface ChallengeAnswer {
  certificate: string;
  assertion: string;
  tier: "account" | "local";
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
 * A server that accepts neither tier refuses with `identity_tier_refused` and
 * says so. Choosing from what the server advertises in `server:info` would be
 * better, since a server accepting only `local` turns away a signed-in user
 * today, but `server:info` and `server:challenge` race on connect and that
 * ordering has to be fixed first.
 */
export async function answerChallenge(
  host: string,
  challenge: { nonce: string; serverHost: string },
): Promise<ChallengeAnswer> {
  const token = await getValidIdentityToken().catch(() => undefined);

  if (token) {
    const certificate = await getValidCertificate();
    const sub = getCertificateSub() || "";
    const assertion = await signAssertion(
      sub,
      challenge.serverHost,
      challenge.nonce,
      { kind: "account" },
    );
    return { certificate, assertion, tier: "account" };
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
