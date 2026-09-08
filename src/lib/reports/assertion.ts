import { base64Url } from "@gryt/crypto";

import { asIdentityScope, deriveScopedKeyPair, jwkThumbprint, signJwtWithKey } from "@/common";

/**
 * Proving a report came from a real Gryt install, without saying which one. **A
 * key derived for this service alone**, never one of the per-server guest keys.
 */

/**
 * The scope this service's key is derived under, and its audience. A scope of its
 * own rather than a server's, which `deriveScopedKeyPair` refuses `srv:` for.
 */
export const REPORTS_SCOPE = asIdentityScope("gryt:reports");

/**
 * Comfortably inside the service's five minutes, without being so tight that a
 * slow request expires in flight.
 */
const LIFETIME_SECONDS = 120;

/** base64url of the SHA-256 of the exact bytes that will be posted. */
async function bodyHash(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return base64Url(new Uint8Array(digest));
}

/**
 * Sign the exact bytes that are about to be posted. Null rather than throwing: a
 * seed that will not open should cost the signature, not the report.
 */
export async function signReport(body: string): Promise<string | null> {
  try {
    const { privateKey, publicJwk } = await deriveScopedKeyPair(REPORTS_SCOPE);
    const now = Math.floor(Date.now() / 1000);

    /* Only the four members the thumbprint is taken over. WebCrypto's export also
     * carries `ext` and `key_ops`, which mean nothing to a verifier. */
    const jwk = {
      kty: publicJwk.kty,
      crv: publicJwk.crv,
      x: publicJwk.x,
      y: publicJwk.y,
    };

    return await signJwtWithKey(
      {
        /* The service recomputes this from the key in the header and compares,
         * which stops somebody attaching another key to their own signature. */
        sub: await jwkThumbprint(jwk),
        aud: REPORTS_SCOPE,
        bh: await bodyHash(body),
        jti: crypto.randomUUID(),
        iat: now,
        exp: now + LIFETIME_SECONDS,
      },
      privateKey,
      /* The public half travels in the protected header, which is how the
       * service verifies a key it has never seen — `jose`'s `EmbeddedJWK`. */
      { jwk },
    );
  } catch (e) {
    console.warn("[Reports] Could not sign this report:", e);
    return null;
  }
}
