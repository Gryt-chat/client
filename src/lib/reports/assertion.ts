import { deriveScopedKeyPair, jwkThumbprint, signJwtWithKey } from "@/common";

/**
 * Proving a report came from a real Gryt install, without saying which one.
 *
 * The app key in the header is friction rather than authentication — the
 * service says so itself: anyone can pull it out of a bundle. This is the part
 * that authenticates. It lets repeat reports from one install be tied together
 * and an abuser be banned by key rather than by whatever address they were on,
 * and it collects nothing about the person.
 *
 * ## Which key
 *
 * **A key derived for this service alone, and not one of the per-server guest
 * keys.** That is the whole decision here. The guest keys are deliberately
 * unlinkable from each other so two servers cannot work out their members are
 * the same person; signing a report with one would tell this service which
 * server the reporter uses, which is the same disclosure in a different
 * direction. `deriveScopedKeyPair` gives a key per scope, so a scope of its own
 * costs nothing and keeps the property.
 *
 * It is still stable across reports and across restoring the same twenty-four
 * words, which is what makes it worth having at all. The mobile app derives the
 * same key from the same seed under the same scope — see
 * `src/feedback/claims.ts` there — so one person's reports tie together across
 * their devices without either app sending anything that says so.
 *
 * ## Why there is no challenge
 *
 * A server join is a challenge-response; there is no round trip here. The
 * service replaces it with three things and the client has to hold up all
 * three: the assertion is bound to the exact bytes posted through `bh`, it
 * expires in five minutes, and its `jti` is accepted once.
 */

/** The scope this service's key is derived under, and its audience. */
export const REPORTS_SCOPE = "gryt:reports";

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
  let binary = "";
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
