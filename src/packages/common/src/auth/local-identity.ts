/**
 * Identity with no account behind it.
 *
 * The mirror of `identity-certificate.ts`, which fetches a certificate the Gryt
 * CA has signed for you. Here nothing is fetched and nobody vouches: the
 * certificate is signed by the very key it describes, and the identity *is* the
 * key. The server accepts it when its `GRYT_IDENTITY_TIERS` includes `local`.
 *
 * That is enough to join, because joining only ever needed proof that the same
 * person came back, and the challenge-response proves that on its own. What an
 * account adds on top is a durable id and a way back in after losing the
 * device, which is worth having and is not what every server needs.
 *
 * One key per host, never shared between servers — see `IdentitySource`.
 */

import { getPublicKeyJwk, signJwt } from "./identity-keys";
import { jwkThumbprint } from "./server-pins";

/**
 * The `iss` the server dispatches on. It must match `SELF_ISSUER` in the
 * server's `auth/identity.ts`; a certificate naming anything else is sent down
 * the CA path instead and rejected for having an untrusted issuer.
 */
const SELF_ISSUER = "gryt:self";

/**
 * Matches the prefix the server puts on a derived id. Kept here so the client
 * can name its own identity without waiting to be told what it is.
 */
const LOCAL_SUB_PREFIX = "key:";

const CERT_LIFETIME_SECONDS = 24 * 60 * 60;

export interface LocalIdentity {
  /** What the server will independently derive, and what the assertion must claim. */
  sub: string;
  certificate: string;
}

/**
 * Build a self-signed certificate for this host's key.
 *
 * Not cached. Signing is a single ECDSA operation over a small payload, and a
 * certificate that lives only as long as the join that used it cannot go stale
 * against a regenerated key — which is the failure the account path needs
 * `certificateMatchesKey` to dig itself out of.
 */
export async function getLocalIdentity(host: string): Promise<LocalIdentity> {
  const source = { kind: "local", host } as const;

  const publicJwk = await getPublicKeyJwk(source);
  const thumbprint = await jwkThumbprint(publicJwk);
  const sub = `${LOCAL_SUB_PREFIX}${thumbprint}`;

  const now = Math.floor(Date.now() / 1000);
  const certificate = await signJwt(
    {
      iss: SELF_ISSUER,
      // The server derives `sub` from the key and ignores this one, on the
      // grounds that a self-signed certificate could otherwise claim any
      // identity at all. Sent anyway so the certificate is readable on its own
      // terms, and it is the same value either way.
      sub,
      jwk: publicJwk,
      iat: now,
      exp: now + CERT_LIFETIME_SECONDS,
    },
    source,
  );

  return { sub, certificate };
}

/** Whether an id belongs to the local tier, readable without asking a server. */
export function isLocalIdentitySub(sub: string): boolean {
  return sub.startsWith(LOCAL_SUB_PREFIX);
}
