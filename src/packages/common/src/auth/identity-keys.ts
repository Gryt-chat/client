/**
 * Client-side ECDSA P-256 keypair management for challenge-response
 * identity authentication. The private key never leaves the client.
 */

const DB_NAME = "gryt_identity_keys";
const DB_VERSION = 1;
const STORE_NAME = "keys";
const KEY_ID = "identity";

/**
 * Where a signing key comes from.
 *
 * `account` is the one key the Gryt CA has issued a certificate for. There is
 * exactly one, because the certificate binds one key to one account, and the
 * account `sub` is the same on every server anyway.
 *
 * `local` is a key generated for one server and used nowhere else. Nothing
 * binds these together, which is the point: a local identity is its own key, so
 * one key per server means two servers cannot tell they are talking to the same
 * person. Costs nothing — the keys are generated on first join and never leave
 * the device either way.
 */
export type IdentitySource =
  | { kind: "account" }
  | { kind: "local"; host: string };

function storageKeyFor(source: IdentitySource): string {
  return source.kind === "account" ? KEY_ID : `local:${source.host}`;
}

const ALGO: EcKeyGenParams = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALGO: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbKeys(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(req.result.map(String));
    req.onerror = () => reject(req.error);
  });
}

interface StoredKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

const cachedKeyPairs = new Map<string, StoredKeyPair>();

async function loadOrGenerateKeyPair(
  source: IdentitySource = { kind: "account" },
): Promise<StoredKeyPair> {
  const storageKey = storageKeyFor(source);
  const cached = cachedKeyPairs.get(storageKey);
  if (cached) return cached;

  const db = await openDB();

  const existing = await idbGet<StoredKeyPair>(db, storageKey);
  if (existing?.privateKey && existing?.publicKey) {
    cachedKeyPairs.set(storageKey, existing);
    db.close();
    return existing;
  }

  // Local keys are extractable so they can be saved and restored; the account
  // key is not, and does not need to be — losing it costs you nothing, because
  // the CA will certify a fresh one for the same account.
  //
  // The trade is smaller than "extractable" makes it sound. A non-extractable
  // key can still be *used* to sign by anything running in this page, so what
  // extractability changes is whether a compromise outlives the page, not
  // whether one is possible. Set against that: without it, clearing site data
  // destroys every server this identity was known on — the roles, the
  // ownership, the history — permanently, silently, and with no way back.
  const extractable = source.kind === "local";

  const keyPair = await crypto.subtle.generateKey(ALGO, extractable, [
    "sign",
    "verify",
  ]);

  const stored: StoredKeyPair = {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
  };

  await idbPut(db, storageKey, stored);
  db.close();

  cachedKeyPairs.set(storageKey, stored);
  console.log(`[Identity] Generated new ECDSA P-256 keypair (${storageKey})`);
  return stored;
}

export async function getPublicKeyJwk(
  source: IdentitySource = { kind: "account" },
): Promise<JsonWebKey> {
  const { publicKey } = await loadOrGenerateKeyPair(source);
  return crypto.subtle.exportKey("jwk", publicKey);
}

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8ToBuffer(str: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(str) as Uint8Array<ArrayBuffer>;
}

/**
 * Sign a compact JWT with an identity key. ES256 throughout, which is what the
 * server pins when it verifies.
 */
export async function signJwt(
  payload: Record<string, unknown>,
  source: IdentitySource = { kind: "account" },
): Promise<string> {
  const { privateKey } = await loadOrGenerateKeyPair(source);

  const header = { alg: "ES256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(utf8ToBuffer(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(utf8ToBuffer(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await crypto.subtle.sign(
    SIGN_ALGO,
    privateKey,
    utf8ToBuffer(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Create a signed assertion JWT for a specific server and nonce.
 * The assertion is bound to the target server (aud) and single-use (nonce).
 *
 * `source` has to be the key the certificate names, since the server verifies
 * the assertion against the key inside the certificate. Presenting an account
 * certificate and signing with a local key produces a signature that fails at
 * the far end for reasons that read like a bug rather than a mismatch.
 */
export async function signAssertion(
  sub: string,
  serverHost: string,
  nonce: string,
  source: IdentitySource = { kind: "account" },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: sub,
      aud: serverHost,
      nonce,
      iat: now,
      exp: now + 60,
    },
    source,
  );
}

const LOCAL_PREFIX = "local:";

/** Which hosts this device holds a local identity for. */
export async function listLocalIdentityHosts(): Promise<string[]> {
  const db = await openDB();
  try {
    return (await idbKeys(db))
      .filter((k) => k.startsWith(LOCAL_PREFIX))
      .map((k) => k.slice(LOCAL_PREFIX.length));
  } finally {
    db.close();
  }
}

export interface IdentityBackup {
  type: "gryt-local-identity-backup";
  version: 1;
  exportedAt: string;
  identities: { host: string; privateJwk: JsonWebKey; publicJwk: JsonWebKey }[];
}

export interface ExportResult {
  backup: IdentityBackup;
  /**
   * Hosts whose key could not be read. Keys made before local identities were
   * extractable cannot be exported at all, and the only honest thing is to name
   * them rather than hand over a backup that quietly omits some servers.
   */
  unexportable: string[];
}

/**
 * Read every local identity out for safekeeping.
 *
 * This is the file that is the person. Anyone holding it can be them on every
 * server listed in it, which is why the UI that calls this says so.
 */
export async function exportLocalIdentities(): Promise<ExportResult> {
  const hosts = await listLocalIdentityHosts();
  const db = await openDB();
  const identities: IdentityBackup["identities"] = [];
  const unexportable: string[] = [];

  try {
    for (const host of hosts) {
      const pair = await idbGet<StoredKeyPair>(db, `${LOCAL_PREFIX}${host}`);
      if (!pair?.privateKey || !pair?.publicKey) continue;
      try {
        identities.push({
          host,
          privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
          publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
        });
      } catch {
        unexportable.push(host);
      }
    }
  } finally {
    db.close();
  }

  return {
    backup: {
      type: "gryt-local-identity-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      identities,
    },
    unexportable,
  };
}

function isBackup(value: unknown): value is IdentityBackup {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<IdentityBackup>;
  return (
    b.type === "gryt-local-identity-backup" &&
    b.version === 1 &&
    Array.isArray(b.identities)
  );
}

/**
 * Put saved identities back, and report which hosts were restored.
 *
 * Existing keys for the same host are replaced. That is the point — you are
 * restoring after losing them — but it does mean importing somebody else's
 * backup would hand you their identity and drop yours, so the UI asks first.
 */
export async function importLocalIdentities(raw: string): Promise<string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file isn't a Gryt identity backup.");
  }
  if (!isBackup(parsed)) {
    throw new Error("That file isn't a Gryt identity backup.");
  }

  const db = await openDB();
  const restored: string[] = [];

  try {
    for (const entry of parsed.identities) {
      if (!entry?.host || !entry.privateJwk || !entry.publicJwk) continue;

      // Imported extractable, so a restored identity can be saved again. A
      // backup that could only be restored once would be a trap.
      const privateKey = await crypto.subtle.importKey(
        "jwk",
        entry.privateJwk,
        ALGO,
        true,
        ["sign"],
      );
      const publicKey = await crypto.subtle.importKey(
        "jwk",
        entry.publicJwk,
        ALGO,
        true,
        ["verify"],
      );

      await idbPut(db, `${LOCAL_PREFIX}${entry.host}`, { privateKey, publicKey });
      restored.push(entry.host);
    }
  } finally {
    db.close();
  }

  // Everything, not just the entries written. Whatever is already cached was
  // read before the restore, so none of it can be trusted to be what the user
  // just asked to be using — and a stale key here is not a stale value, it is
  // signing as the wrong person.
  //
  // The caller reloads as well. This alone is not enough: anything that already
  // read a key holds it, and clearing the map cannot reach into those.
  cachedKeyPairs.clear();

  if (restored.length === 0) {
    throw new Error("That backup contained no identities.");
  }
  return restored;
}

/**
 * Clear the account keypair. Used on logout or key rotation.
 *
 * Deliberately leaves local keys alone. Signing out of a Gryt account says
 * nothing about the servers you joined without one, and destroying those keys
 * would drop every local identity — with it the roles, ownership and history
 * attached to them — with no way back. Logging out is not a request to be
 * forgotten everywhere.
 */
export async function clearIdentityKeys(): Promise<void> {
  cachedKeyPairs.delete(KEY_ID);
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).delete(KEY_ID);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch {
    // Best effort
  }
}
