/**
 * Fetches and caches identity certificates from the Gryt Identity Service. A
 * certificate is **not a bearer token** — it only proves ownership of a key.
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
 * Does this certificate still describe the key we would sign with? The keypair is
 * in IndexedDB and the certificate in localStorage, so clearing one drifts them.
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
 * Which account is signed in at this moment, or null when nothing can say. Null is
 * "no answer", not "a different person" — a laptop off the network is one.
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
     * The decision is `certificateVerdict`; this reads what it needs and acts on
     * the answer. Both reads cost something, which is why the rule lives apart.
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
       * And the key with it: minting a new certificate over the previous
       * account's key hands two accounts one key. Safe to drop — it is random.
       */
      await clearIdentityKeys().catch(() => {});
    } else if (verdict === "wrong-key") {
      // Unexpired is not the same as usable: a certificate naming a key we no
      // longer hold is never renewed, so the client stays wedged until it expires.
      console.warn(
        "[Identity] Cached certificate does not match the current keypair — renewing."
      );
      clearIdentityCertificate();
    }
    // `stale` falls through to the fetch with the old certificate still stored. A
    // renewal that cannot reach the network should not also cost us the `sub`.
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
