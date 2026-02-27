/**
 * Client-side ECDSA P-256 keypair management for challenge-response
 * identity authentication. The private key never leaves the client.
 */

const DB_NAME = "gryt_identity_keys";
const DB_VERSION = 1;
const STORE_NAME = "keys";
const KEY_ID = "identity";

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

interface StoredKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

let cachedKeyPair: StoredKeyPair | null = null;

async function loadOrGenerateKeyPair(): Promise<StoredKeyPair> {
  if (cachedKeyPair) return cachedKeyPair;

  const db = await openDB();

  const existing = await idbGet<StoredKeyPair>(db, KEY_ID);
  if (existing?.privateKey && existing?.publicKey) {
    cachedKeyPair = existing;
    db.close();
    return existing;
  }

  const keyPair = await crypto.subtle.generateKey(ALGO, false, [
    "sign",
    "verify",
  ]);

  const stored: StoredKeyPair = {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
  };

  await idbPut(db, KEY_ID, stored);
  db.close();

  cachedKeyPair = stored;
  console.log("[Identity] Generated new ECDSA P-256 keypair");
  return stored;
}

export async function getPublicKeyJwk(): Promise<JsonWebKey> {
  const { publicKey } = await loadOrGenerateKeyPair();
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
 * Create a signed assertion JWT for a specific server and nonce.
 * The assertion is bound to the target server (aud) and single-use (nonce).
 */
export async function signAssertion(
  sub: string,
  serverHost: string,
  nonce: string,
): Promise<string> {
  const { privateKey } = await loadOrGenerateKeyPair();

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: "JWT" };
  const payload = {
    iss: sub,
    aud: serverHost,
    nonce,
    iat: now,
    exp: now + 60,
  };

  const encodedHeader = base64UrlEncode(utf8ToBuffer(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(utf8ToBuffer(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await crypto.subtle.sign(
    SIGN_ALGO,
    privateKey,
    utf8ToBuffer(signingInput),
  );

  const encodedSignature = base64UrlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Clear the stored keypair. Used on logout or key rotation.
 */
export async function clearIdentityKeys(): Promise<void> {
  cachedKeyPair = null;
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
