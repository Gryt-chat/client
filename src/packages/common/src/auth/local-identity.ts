/**
 * Identity with no account behind it: the certificate is signed by the very key it
 * describes. One key per host, never shared between servers.
 */

import {
  clearDelegation,
  delegationSub,
  getStoredDelegation,
  isDelegationExpired,
} from "./device-delegation";
import { getPublicKeyJwk, signJwt } from "./identity-keys";
import { jwkThumbprint } from "./server-pins";

/**
 * The `iss` the server dispatches on. It must match `SELF_ISSUER` in the server's
 * `auth/identity.ts`, or the certificate goes down the CA path and is rejected.
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
 * Build a self-signed certificate for this host's key. Not cached: signing is one
 * ECDSA operation, and a short-lived certificate cannot go stale against the key.
 */
export async function getLocalIdentity(host: string): Promise<LocalIdentity> {
  const source = { kind: "local", host } as const;

  // A delegation, if this device was authorised rather than restored. It names
  // somebody else's key, so it has to win over the self-signed certificate.
  const delegation = getStoredDelegation(host);
  if (delegation) {
    if (isDelegationExpired(delegation)) {
      // Deliberately fatal rather than falling back: self-signing here joins as
      // this device's own key, a different `sub` with none of the history.
      clearDelegation(host);
      throw new Error(
        `This device's authorisation for ${host} has expired. ` +
          `Authorise it again from Settings → You → Security.`,
      );
    }

    const sub = await delegationSub(delegation);
    if (sub) return { sub, certificate: delegation };

    // Unreadable. Same reasoning as expiry — do not guess at an identity.
    clearDelegation(host);
    throw new Error(
      `This device's authorisation for ${host} could not be read. ` +
        `Authorise it again from Settings → You → Security.`,
    );
  }

  const publicJwk = await getPublicKeyJwk(source);
  const thumbprint = await jwkThumbprint(publicJwk);
  const sub = `${LOCAL_SUB_PREFIX}${thumbprint}`;

  const now = Math.floor(Date.now() / 1000);
  const certificate = await signJwt(
    {
      iss: SELF_ISSUER,
      // The server derives `sub` from the key and ignores this one, since a
      // self-signed certificate could claim any identity at all.
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

/** The `iss` the server dispatches a link proof on. */
const LINK_ISSUER = "gryt:link";

/**
 * Prove that the account joining is the same person who was here without one.
 * Sent only when a local key for the host already exists — generating one to
 * prove ownership of it would prove nothing.
 */
export async function signIdentityLink(
  host: string,
  serverHost: string,
  nonce: string,
  accountSub: string,
): Promise<string> {
  const source = { kind: "local", host } as const;
  const publicJwk = await getPublicKeyJwk(source);
  const now = Math.floor(Date.now() / 1000);

  return signJwt(
    {
      iss: LINK_ISSUER,
      aud: serverHost,
      jwk: publicJwk,
      nonce,
      link_to: accountSub,
      iat: now,
      exp: now + 60,
    },
    source,
  );
}
