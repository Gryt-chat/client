import { base64Url } from "@gryt/crypto";

import { asIdentityScope, deriveScopedKeyPair, jwkThumbprint, signJwtWithKey } from "@/common";

/**
 * Proving a report came from a real Gryt install, without saying which one. It
 * ties repeat reports from one install together and lets an abuser be banned by
 * key rather than by address, collecting nothing about the person.
 *
 * **A key derived for this service alone, never one of the per-server guest
 * keys.** Those are deliberately unlinkable, so signing a report with one would
 * tell this service which server the reporter uses. Mobile derives the same key
 * from the same seed under the same scope — see `src/feedback/claims.ts` there.
 *
 * No challenge, so the service replaces one with three things the client has to
 * hold up together: the assertion is bound to the exact bytes posted through
 * `bh`, it expires in five minutes, and its `jti` is accepted once.
 */

/**
 * The scope this service's key is derived under, and its audience.
 *
 * A scope of its own rather than a server's, which is what `deriveScopedKeyPair`
 * refuses a `srv:` prefix for.
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
 * Sign the exact bytes that are about to be posted.
 *
 * Null rather than throwing. The signature is optional at the service until
 * every client sends one, so a seed that will not open should cost the
 * signature and not the report — somebody trying to tell us the app is broken
 * is exactly who should not be refused.
 */
export async function signReport(body: string): Promise<string | null> {
  try {
    const { privateKey, publicJwk } = await deriveScopedKeyPair(REPORTS_SCOPE);
    const now = Math.floor(Date.now() / 1000);

    /* Only the four members the thumbprint is taken over. WebCrypto's export
     * also carries `ext` and `key_ops`, which describe what this device is
     * allowed to do with the key and mean nothing to a verifier — and the
     * header is the one place a stray member would travel to somebody else. */
    const jwk = {
      kty: publicJwk.kty,
      crv: publicJwk.crv,
      x: publicJwk.x,
      y: publicJwk.y,
    };

    return await signJwtWithKey(
      {
        /* The service recomputes this from the key in the header and compares,
         * which is what stops somebody attaching another key to their own
         * signature. */
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
