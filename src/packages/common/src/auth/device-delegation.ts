import { base64Url as encodeBase64Url } from "@gryt/crypto";

/**
 * Being yourself on a new device without moving your key to it.
 *
 * Restoring a saved identity copies the private key into a second browser, so
 * it exists in two places and the second one is as much "you" as the first,
 * forever. Authorising is the other way round: the saved key signs a statement
 * that *this* device's key is you, and then goes back in the drawer. The key
 * touches memory once and is never stored here.
 *
 * The saved file holds a separate key per server, so this works per server too.
 * For each host in the file, the key that was your identity there vouches for
 * the key this device just generated for that same host — which is why your
 * servers come back with the roles and ownership you had, rather than as a
 * stranger with a familiar name.
 */
import { getPublicKeyJwk, parseIdentityBackup } from "./identity-keys";
import { jwkThumbprint } from "./server-pins";

/** Must match `DELEGATED_ISSUER` in the server's `auth/identity.ts`. */
const DELEGATED_ISSUER = "gryt:delegated";

const LOCAL_SUB_PREFIX = "key:";

/**
 * How long a delegation is good for.
 *
 * Expiry is the only revocation there is — the server keeps no list — so this
 * is really the answer to "how long does a stolen laptop stay me?". Thirty days
 * is short enough that the answer is not "forever" and long enough that
 * re-authorising is not a weekly chore. Re-authorising needs the identity file
 * again, so making this very short would punish the careful more than the
 * unlucky.
 */
const DELEGATION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const STORAGE_PREFIX = "gryt_device_delegation:";

const ALGO: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALGO: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

function storageKey(host: string): string {
  return `${STORAGE_PREFIX}${host}`;
}

export function getStoredDelegation(host: string): string | null {
  try {
    return localStorage.getItem(storageKey(host));
  } catch {
    return null;
  }
}

export function clearDelegation(host: string): void {
  try {
    localStorage.removeItem(storageKey(host));
  } catch {
    // ignore
  }
}

/** Hosts this device has been authorised for, and when each runs out. */
export function listDelegations(): { host: string; expiresAt: number | null }[] {
  const out: { host: string; expiresAt: number | null }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const cert = localStorage.getItem(key);
      out.push({
        host: key.slice(STORAGE_PREFIX.length),
        expiresAt: cert ? delegationExpiry(cert) : null,
      });
    }
  } catch {
    // localStorage not available
  }
  return out;
}

function decodePayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    return JSON.parse(
      atob(part.replace(/-/g, "+").replace(/_/g, "/")),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** When a delegation stops being accepted, in ms, or null if unreadable. */
export function delegationExpiry(certificate: string): number | null {
  const exp = decodePayload(certificate)?.exp;
  return typeof exp === "number" ? exp * 1000 : null;
}

export function isDelegationExpired(certificate: string): boolean {
  const expiresAt = delegationExpiry(certificate);
  // Unreadable counts as expired. A certificate we cannot reason about is not
  // one to present.
  return expiresAt === null || expiresAt <= Date.now();
}

/**
 * The identity a delegation grants, which is the key that *signed* it.
 *
 * Derived here the same way the server derives it, so the assertion can claim
 * the right `sub` without a round trip to be told what it is.
 */
export async function delegationSub(certificate: string): Promise<string | null> {
  const issJwk = decodePayload(certificate)?.iss_jwk;
  if (!issJwk || typeof issJwk !== "object") return null;
  try {
    return `${LOCAL_SUB_PREFIX}${await jwkThumbprint(issJwk as JsonWebKey)}`;
  } catch {
    return null;
  }
}

/* Only the coercion is local; the encoding is @gryt/crypto's (GRYT-898). */
function base64Url(buf: ArrayBuffer | Uint8Array): string {
  return encodeBase64Url(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
}


/**
 * Use a saved identity to vouch for this device, once, and keep only the
 * result.
 *
 * The imported key is deliberately not put anywhere: not IndexedDB, not the
 * keypair cache, not a module variable that outlives this call. It signs and is
 * dropped. That is the entire difference between this and restoring.
 */
export async function authoriseDeviceFromBackup(raw: string): Promise<string[]> {
  const authorised: string[] = [];

  for (const entry of parseIdentityBackup(raw).identities) {
    if (!entry.privateJwk) continue;

    // A delegation is filed per address, which is where `getStoredDelegation`
    // looks for it. Entries from before identities carried a display label have
    // the address as their scope, so that is the fallback.
    const host = entry.host ?? entry.scope;

    // Not extractable. Nothing here needs to read it back, and a key that
    // cannot be exported cannot be exported by accident either.
    const userKey = await crypto.subtle.importKey(
      "jwk",
      entry.privateJwk,
      ALGO,
      false,
      ["sign"],
    );

    // Generated on demand if this device has never talked to that host.
    const deviceJwk = await getPublicKeyJwk({ kind: "local", host });

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "ES256", typ: "JWT" };
    const payload = {
      iss: DELEGATED_ISSUER,
      iss_jwk: entry.publicJwk,
      jwk: deviceJwk,
      iat: now,
      exp: now + DELEGATION_LIFETIME_SECONDS,
    };

    const encoder = new TextEncoder();
    const signingInput = `${base64Url(encoder.encode(JSON.stringify(header)))}.${base64Url(
      encoder.encode(JSON.stringify(payload)),
    )}`;
    const signature = await crypto.subtle.sign(
      SIGN_ALGO,
      userKey,
      encoder.encode(signingInput),
    );

    try {
      localStorage.setItem(
        storageKey(host),
        `${signingInput}.${base64Url(signature)}`,
      );
      authorised.push(host);
    } catch {
      // Out of storage, or blocked. Skipped rather than reported as done.
    }
  }

  if (authorised.length === 0) {
    throw new Error("That backup contained no identities this device can use.");
  }
  return authorised;
}
