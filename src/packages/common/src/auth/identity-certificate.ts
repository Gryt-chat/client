/**
 * Fetches and caches identity certificates from the Gryt Identity Service.
 * A certificate is a JWT signed by the Gryt CA that binds a user's public
 * key to their Gryt identity. It is NOT a bearer token -- it only proves
 * ownership of a public key.
 */

import { getGrytConfig } from "../../../../config";
import { getValidIdentityToken } from "./keycloak";
import { getPublicKeyJwk } from "./identity-keys";

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
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function parseJwtSub(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
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
 * Returns a valid identity certificate, fetching/renewing if needed.
 * The certificate is a JWT proving that a public key belongs to a Gryt user.
 */
export async function getValidCertificate(): Promise<string> {
  const stored = getStoredCert();
  if (stored && stored.expiresAt > Date.now() + RENEW_BUFFER_MS) {
    return stored.certificate;
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
