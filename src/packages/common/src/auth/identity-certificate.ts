/**
 * Fetches and caches identity certificates from the Gryt Identity Service.
 * A certificate is a JWT signed by the Gryt CA that binds a user's public
 * key to their Gryt identity. It is NOT a bearer token -- it only proves
 * ownership of a public key.
 */
import { getGrytConfig } from "../../../../config";
import { certificateVerdict } from "./certificate-verdict";
import { clearIdentityKeys, getPublicKeyJwk } from "./identity-keys";
import { decodeJwt } from "./jwt";
import { getValidIdentityToken } from "./keycloak";

const CERT_STORAGE_KEY = "gryt_identity_certificate";
const RENEW_BUFFER_MS = 24 * 60 * 60 * 1000; // Renew 24h before expiry

interface StoredCert {
  certificate: string;
  expiresAt: number;
}

function parseJwtExp(jwt: string): number | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = decodeJwt<Record<string, unknown>>(jwt) ?? {};
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function parseJwtSub(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = decodeJwt<Record<string, unknown>>(jwt) ?? {};
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function parseJwtJwk(jwt: string): JsonWebKey | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = decodeJwt<Record<string, unknown>>(jwt) ?? {};
    return payload.jwk && typeof payload.jwk === "object" ? (payload.jwk as JsonWebKey) : null;
  } catch {
    return null;
  }
}

/**
 * Does this certificate still describe the key we would sign with?
 *
 * The certificate binds a public key to an identity, and the server verifies
 * the assertion against the key inside the certificate. So a certificate that
 * names a different key is worthless — worse than none, because it looks valid
 * and fails at the far end.
 *
 * The two can drift apart because they live in different places. The keypair is
 * in IndexedDB and is silently regenerated when it is missing; the certificate
 * is in localStorage, which Electron restores across profiles. Clear one and not
 * the other — a profile reset, a cache wipe — and the client signs with a new
 * key while presenting the old certificate.
 *
 * Comparing x and y is enough: they are the P-256 public point, so a matching
 * pair means the same key. crv and kty are implied by the algorithm we use.
 */
function certificateMatchesKey(certificate: string, currentJwk: JsonWebKey): boolean {
  const certJwk = parseJwtJwk(certificate);
  if (!certJwk) return false;
  return certJwk.x === currentJwk.x && certJwk.y === currentJwk.y;
}

function getStoredCert(): StoredCert | null {
  try {
    const raw = localStorage.getItem(CERT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredCert;
  } catch {
    return null;
  }
}

function storeCert(cert: StoredCert): void {
  try {
    localStorage.setItem(CERT_STORAGE_KEY, JSON.stringify(cert));
  } catch {
    // Ignore storage errors
  }
}

export function clearIdentityCertificate(): void {
  try {
    localStorage.removeItem(CERT_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

let fetchPromise: Promise<string> | null = null;

async function fetchCertificateFromService(): Promise<string> {
  const cfg = getGrytConfig();
  const identityUrl = cfg.GRYT_IDENTITY_URL.replace(/\/+$/, "");

  const keycloakToken = await getValidIdentityToken();
  if (!keycloakToken) {
    throw new Error("Not authenticated with Keycloak");
  }

  const publicJwk = await getPublicKeyJwk();

  const res = await fetch(`${identityUrl}/api/v1/certificate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${keycloakToken}`,
    },
    body: JSON.stringify({ jwk: publicJwk }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Certificate request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  if (!data.certificate || typeof data.certificate !== "string") {
    throw new Error("Invalid certificate response from identity service");
  }

  const expiresAt = parseJwtExp(data.certificate);
  if (expiresAt) {
    storeCert({ certificate: data.certificate, expiresAt });
  }

  console.log("[Identity] Obtained new identity certificate");
  return data.certificate;
}

/**
 * Which account is signed in at this moment, or null when nothing can say.
 *
 * Null covers being signed out, a lapsed session and a refresh that could not
 * reach Keycloak. All three mean "no answer", not "a different person", and the
 * caller treats them that way — a laptop off the network must not throw away a
 * certificate it may be about to need.
 */
async function signedInSub(): Promise<string | null> {
  const token = await getValidIdentityToken().catch(() => undefined);
  return token ? parseJwtSub(token) : null;
}

/**
 * Returns a valid identity certificate, fetching/renewing if needed.
 * The certificate is a JWT proving that a public key belongs to a Gryt user.
 */
export async function getValidCertificate(): Promise<string> {
  const stored = getStoredCert();
  if (stored) {
    /*
     * The decision is `certificateVerdict`; this reads what it needs and acts
     * on the answer.
     *
     * Both reads cost something — `signedInSub` may refresh a token and
     * `getPublicKeyJwk` opens IndexedDB — which is exactly why the rule lives
     * in a module with no imports and this one does the fetching.
     */
    const verdict = certificateVerdict({
      certificateSub: parseJwtSub(stored.certificate),
      signedInSub: await signedInSub(),
      matchesKey: certificateMatchesKey(stored.certificate, await getPublicKeyJwk()),
      needsRenewal: stored.expiresAt <= Date.now() + RENEW_BUFFER_MS,
    });

    if (verdict === "use") return stored.certificate;

    if (verdict === "wrong-account") {
      console.warn(
        "[Identity] Cached certificate belongs to another account — discarding it.",
      );
      clearIdentityCertificate();
      /*
       * And the key with it. The certificate binds one `sub` to one public key,
       * so minting a new certificate over the key the previous account was
       * using would hand two accounts the same key — and a server that pinned
       * it sees one key arrive under a second name.
       *
       * Safe to drop: an account key is random rather than derived
       * (`identity-keys.ts`), the CA certifies a fresh one on the next
       * sign-in, and DM keys come off the seed, which this does not touch.
       */
      await clearIdentityKeys().catch(() => {});
    } else if (verdict === "wrong-key") {
      // Unexpired is not the same as usable. A certificate that names a key we
      // no longer hold produces an assertion the server rejects with "signature
      // verification failed", and because the certificate is still in date it is
      // never renewed — the client stays wedged until it expires on its own.
      //
      // Checking here means the mismatch repairs itself on the next join, with
      // nothing for the user to do.
      console.warn(
        "[Identity] Cached certificate does not match the current keypair — renewing."
      );
      clearIdentityCertificate();
    }
    // `stale` falls through to the fetch below with the old certificate still
    // in storage. A renewal that cannot reach the network should not also cost
    // us the `sub` that `getCertificateSub` reads back out of it.
  }

  if (fetchPromise) return fetchPromise;

  fetchPromise = fetchCertificateFromService().finally(() => {
    fetchPromise = null;
  });

  return fetchPromise;
}

/**
 * Extract the Gryt user ID (sub) from a cached certificate.
 * Returns null if no certificate is cached or it can't be parsed.
 */
export function getCertificateSub(): string | null {
  const stored = getStoredCert();
  if (!stored) return null;
  return parseJwtSub(stored.certificate);
}
