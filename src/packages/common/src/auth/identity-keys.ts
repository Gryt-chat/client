import { base64Url as sharedBase64Url, base64UrlDecode as sharedBase64UrlDecode } from "@gryt/crypto";
/**
 * Client-side ECDSA P-256 keypair management for challenge-response
 * identity authentication. The private key never leaves the client.
 */
import {
  deriveDmKeyPair,
  type DmKeyPair,
  signDmKeyBinding,
} from "@gryt/crypto";

import { getElectronAPI } from "../../../../lib/electron";
import { clearAllServerTokens } from "../utils/tokenStorage";
import {
  hasGuestScope,
  listGuestScopes,
  rememberGuestScope,
  rememberGuestScopes,
} from "./guest-history";
import {
  asIdentityScope,
  deriveLocalKeyPair,
  generateSeed,
  type IdentityScope,
  SEED_BYTES,
  seedToWords,
  wordsToSeed,
} from "./identity-seed";
import { identitySourceUsedFor } from "./identity-source";
import { jwkThumbprint } from "./server-pins";
import { getOriginKeyIdForHost } from "./server-pins";

const DB_NAME = "gryt_identity_keys";
const DB_VERSION = 1;
const STORE_NAME = "keys";
const KEY_ID = "identity";
const SEED_KEY = "identity-seed";
const LOCAL_PREFIX = "local:";
const SERVER_SCOPE_PREFIX = "srv:";

/**
 * Where a signing key comes from. `account` is the one the Gryt CA certifies;
 * `local` is per server, and **nothing binds two of them as far as a server sees**.
 */
export type IdentitySource =
  | { kind: "account" }
  | { kind: "local"; host: string };

/**
 * What a local identity is filed and derived under. **The server, not the address
 * it answers on**, and the lineage id rather than today's key (GRYT-257, GRYT-54).
 */

/*
 * Re-exported here because this is where a consumer looks: `identity-seed.ts` is
 * not in the `@/common` barrel, and the type is declared there for `dm-keys.ts`.
 */
export { asIdentityScope, type IdentityScope };

export function identityScopeFor(host: string): IdentityScope {
  const origin = getOriginKeyIdForHost(host);
  return asIdentityScope(origin ? `${SERVER_SCOPE_PREFIX}${origin}` : host);
}

function storageKeyFor(source: IdentitySource): string {
  return source.kind === "account"
    ? KEY_ID
    : `${LOCAL_PREFIX}${identityScopeFor(source.host)}`;
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

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(key);
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
  /**
   * Last address this identity was used at. Display only — never a key, and never
   * what anything is looked up by. Absent on entries written before GRYT-257.
   */
  host?: string;
}

const cachedKeyPairs = new Map<string, StoredKeyPair>();

/**
 * How the seed sits in the database: sealed by the OS keychain where there is one
 * and raw where there is not. Both shapes are read (GRYT-256).
 */
type StoredSeed = Uint8Array | { sealed: string };

/** The bridge, but only when the OS will actually encrypt for us. */
async function osKeychain() {
  const api = getElectronAPI();
  if (!api?.secretsAvailable || !api.sealSecret) return null;
  try {
    return (await api.secretsAvailable()) ? api : null;
  } catch {
    return null;
  }
}

async function writeSeed(db: IDBDatabase, seed: Uint8Array): Promise<void> {
  const api = await osKeychain();
  if (!api) {
    await idbPut(db, SEED_KEY, seed);
    return;
  }
  await idbPut(db, SEED_KEY, {
    sealed: await api.sealSecret(base64UrlEncode(seed)),
  });
}

/**
 * Read the seed back, whichever way it was written. **A sealed seed that will not
 * open throws** — treating it as missing hands out a new identity everywhere.
 */
async function readSeed(stored: StoredSeed | undefined): Promise<Uint8Array | null> {
  if (!stored) return null;

  if (stored instanceof Uint8Array) {
    return stored.length === SEED_BYTES ? stored : null;
  }
  if (typeof stored.sealed !== "string") return null;

  const api = getElectronAPI();
  if (!api?.unsealSecret) {
    throw new Error(
      "This identity was locked to this computer and cannot be read here. " +
        "Restore it from your identity backup instead.",
    );
  }

  let seed: Uint8Array;
  try {
    seed = base64UrlDecode(await api.unsealSecret(stored.sealed));
  } catch {
    throw new Error(
      "Your saved identity could not be unlocked. If this computer's keychain " +
        "was reset, restore from your identity backup.",
    );
  }
  if (seed.length !== SEED_BYTES) {
    throw new Error("Your saved identity is damaged and could not be read.");
  }
  return seed;
}

/**
 * The seed every local key is calculated from, made on first use. Not filed under
 * `local:`, and deliberately not cleared by `clearIdentityKeys`.
 */
async function getOrCreateSeed(db: IDBDatabase): Promise<Uint8Array> {
  const existing = await readSeed(await idbGet<StoredSeed>(db, SEED_KEY));
  if (existing) return existing;

  const seed = generateSeed();
  await writeSeed(db, seed);
  console.log("[Identity] Generated new local identity seed");
  return seed;
}

/** Checked once a session; the answer cannot change while the app is running. */
let seedSealChecked = false;

/**
 * Seal a seed that was written when no keychain was reachable. Not left to
 * `getOrCreateSeed`, which only runs when a key has to be worked out.
 */
async function ensureSeedSealed(db: IDBDatabase): Promise<void> {
  if (seedSealChecked) return;
  seedSealChecked = true;

  try {
    const stored = await idbGet<StoredSeed>(db, SEED_KEY);
    if (!(stored instanceof Uint8Array)) return;
    if (!(await osKeychain())) return;

    await writeSeed(db, stored);
    console.log("[Identity] Locked the identity seed with the OS keychain");
  } catch (e) {
    console.warn("[Identity] Could not lock the identity seed:", e);
  }
}

async function loadOrGenerateKeyPair(
  source: IdentitySource = { kind: "account" },
): Promise<StoredKeyPair> {
  const storageKey = storageKeyFor(source);
  const cached = cachedKeyPairs.get(storageKey);
  if (cached) return cached;

  const db = await openDB();

  if (source.kind === "local") await ensureSeedSealed(db);

  const existing = await idbGet<StoredKeyPair>(db, storageKey);
  if (existing?.privateKey && existing?.publicKey) {
    cachedKeyPairs.set(storageKey, existing);
    db.close();
    return existing;
  }

  // A local key is derived from the seed, so the same identity comes back on any
  // device holding it. **Local keys are extractable so they can be restored.**
  const stored: StoredKeyPair =
    source.kind === "local"
      ? {
          // Calculated from the scope, not the address: another device with the
          // seed derives the same key, and it survives the server moving.
          ...(await deriveLocalKeyPair(
            await getOrCreateSeed(db),
            identityScopeFor(source.host),
          )),
          host: source.host,
        }
      : await crypto.subtle.generateKey(ALGO, false, ["sign", "verify"]);

  // A derived key is not written down: it is reproducible from the seed and the
  // scope. The account key is random, so it is still stored.
  if (source.kind === "local") {
    rememberGuestScope(identityScopeFor(source.host));
  } else {
    await idbPut(db, storageKey, stored);
  }
  db.close();

  cachedKeyPairs.set(storageKey, stored);
  console.log(
    `[Identity] ${
      source.kind === "local" ? "Derived" : "Generated and stored"
    } ECDSA P-256 keypair (${storageKey})`,
  );
  return stored;
}

export async function getPublicKeyJwk(
  source: IdentitySource = { kind: "account" },
): Promise<JsonWebKey> {
  const { publicKey } = await loadOrGenerateKeyPair(source);
  return crypto.subtle.exportKey("jwk", publicKey);
}

/* Only the coercion is local; the encoding is @gryt/crypto's (GRYT-898). */
function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  return sharedBase64Url(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  return sharedBase64UrlDecode(value) as Uint8Array<ArrayBuffer>;
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
  return signJwtWithKey(payload, privateKey);
}

/**
 * The same signature, over a key the caller already holds, with the public half in
 * the protected header. `alg` and `typ` are applied after `extraHeader`.
 */
export async function signJwtWithKey(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
  extraHeader?: Record<string, unknown>,
): Promise<string> {
  const header = { ...extraHeader, alg: "ES256", typ: "JWT" };
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
 * A key from this device's seed for something that is not a Gryt server. **`scope`
 * shares a namespace with `identityScopeFor`**, which prefixes servers with `srv:`.
 */

/**
 * The binding this device would publish for one server. **`source` has to be the
 * identity this device actually joined with** — the signature depends on it.
 */
export async function dmKeyBindingFor(host: string): Promise<string | null> {
  const scope = identityScopeFor(host);

  const db = await openDB();
  let seed: Uint8Array;
  try {
    seed = await getOrCreateSeed(db);
  } finally {
    db.close();
  }

  /*
   * **Signed with the key derived from the seed, whichever identity joined this
   * server**: an account key is random per device, so two of them flip (GRYT-759).
   */
  const identity = await deriveLocalKeyPair(seed, scope);
  const identityPublicJwk = await crypto.subtle.exportKey("jwk", identity.publicKey);
  const { publicKey } = deriveDmKeyPair(seed, scope);

  return signDmKeyBinding({
    dmPublicKey: publicKey,
    scope,
    identityPrivateKey: identity.privateKey,
    identityPublicJwk,
  });
}

/**
 * The DM public key this device uses on one server, for checking your own row: a
 * member list showing something else under your id is the server rewriting it.
 */

/**
 * This device's DM keypair for one server, private half included. **The one
 * accessor that hands out key material** — `sealMessage` and `openMessage` only.
 */
export async function ownDmKeyPair(host: string): Promise<DmKeyPair> {
  const db = await openDB();
  try {
    return deriveDmKeyPair(await getOrCreateSeed(db), identityScopeFor(host));
  } finally {
    db.close();
  }
}

/**
 * This device's own half of a comparison code, for one server. Public halves only;
 * the code is meant to be read out loud (GRYT-730).
 */
export async function ownComparisonSide(
  host: string,
): Promise<{ thumbprint: string; dmPublicKey: string }> {
  const source = identitySourceUsedFor(host) ?? { kind: "local" as const, host };
  const [publicJwk, dm] = await Promise.all([
    getPublicKeyJwk(source),
    ownDmPublicKey(host),
  ]);

  return {
    thumbprint: await jwkThumbprint(publicJwk),
    dmPublicKey: base64UrlEncode(dm),
  };
}

export async function ownDmPublicKey(host: string): Promise<Uint8Array> {
  const db = await openDB();
  try {
    return deriveDmKeyPair(await getOrCreateSeed(db), identityScopeFor(host))
      .publicKey;
  } finally {
    db.close();
  }
}

export async function deriveScopedKeyPair(
  scope: IdentityScope,
): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> {
  if (scope.startsWith(SERVER_SCOPE_PREFIX)) {
    throw new Error(`"${scope}" is a server's scope, not a standalone one`);
  }

  const db = await openDB();
  try {
    const { privateKey, publicKey } = await deriveLocalKeyPair(
      await getOrCreateSeed(db),
      scope,
    );
    return {
      privateKey,
      publicJwk: await crypto.subtle.exportKey("jwk", publicKey),
    };
  } finally {
    db.close();
  }
}

/**
 * A signed assertion JWT for one server and nonce. **`source` has to be the key the
 * certificate names**, or the far end fails in a way that reads like a bug.
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

/** Every local identity on this device, by what it is filed under. */
async function listLocalIdentityScopes(
  db: IDBDatabase,
): Promise<IdentityScope[]> {
  // Written through storageKeyFor, which builds them from identityScopeFor, so
  // what comes back out is what went in.
  return (await idbKeys(db))
    .filter((k) => k.startsWith(LOCAL_PREFIX))
    .map((k) => asIdentityScope(k.slice(LOCAL_PREFIX.length)));
}

/**
 * Whether this device already has a local identity for a server. It has to mean
 * "was joined as a guest" — the seed can derive a key for anywhere (GRYT-254).
 */
export async function hasLocalIdentity(host: string): Promise<boolean> {
  const scope = identityScopeFor(host);
  if (hasGuestScope(scope)) return true;

  // Falls back to the stored key for anyone not through the backfill yet, so an
  // upgrade cannot lose somebody the offer to carry an identity over.
  const db = await openDB();
  try {
    const pair = await idbGet<StoredKeyPair>(db, storageKeyFor({ kind: "local", host }));
    const held = Boolean(pair?.privateKey && pair?.publicKey);
    if (held) rememberGuestScope(scope);
    return held;
  } finally {
    db.close();
  }
}

/**
 * Teach the guest history what the stored keys already know. Reads rather than
 * derives: the point is what was used, not what could be (GRYT-285).
 */

/**
 * Delete stored local keys the seed can reproduce. **Each is checked rather than
 * assumed** — a key that does not match is the only copy, and deleting it kills it.
 */
export async function pruneReproducibleKeys(): Promise<void> {
  try {
    const db = await openDB();
    try {
      const seed = await readSeed(await idbGet<StoredSeed>(db, SEED_KEY));
      if (!seed) return;

      let removed = 0;
      let kept = 0;
      for (const scope of await listLocalIdentityScopes(db)) {
        const pair = await idbGet<StoredKeyPair>(db, `${LOCAL_PREFIX}${scope}`);
        if (!pair?.publicKey) continue;

        const stored = await crypto.subtle.exportKey("jwk", pair.publicKey);
        const derived = await crypto.subtle.exportKey(
          "jwk",
          (await deriveLocalKeyPair(seed, scope)).publicKey,
        );

        // The public coordinates. Two keys agreeing on both are the same key,
        // and comparing the private half would mean exporting it for no gain.
        if (stored.x === derived.x && stored.y === derived.y) {
          await idbDelete(db, `${LOCAL_PREFIX}${scope}`);
          removed++;
        } else {
          kept++;
        }
      }

      if (removed || kept) {
        console.log(
          `[Identity] Pruned ${removed} reproducible local key(s); kept ${kept} the seed cannot derive`,
        );
      }
    } finally {
      db.close();
    }
  } catch (e) {
    // Leaving the keys where they are costs disk and nothing else. The derived
    // key is identical either way, so nobody is locked out by this failing.
    console.warn("[Identity] Could not prune stored local keys:", e);
  }
}

export async function backfillGuestHistory(): Promise<void> {
  try {
    const db = await openDB();
    try {
      rememberGuestScopes(await listLocalIdentityScopes(db));
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn("[Identity] Could not backfill guest history:", e);
  }
}

export interface IdentityBackupEntry {
  /**
   * What the identity is filed under: a server lineage since GRYT-257, an address
   * before it. Restored under the same name and moved on the next join.
   */
  scope: string;
  /** Last address it was used at. Display only. */
  host?: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}

export interface IdentityBackup {
  type: "gryt-local-identity-backup";
  version: 2;
  exportedAt: string;
  /**
   * The seed, base64url. Absent in files written before it existed. Carried
   * alongside the keys: identities generated at random travel as themselves.
   */
  seed?: string;
  identities: IdentityBackupEntry[];
}

/** Version 1, where `host` held what version 2 calls `scope`. Read, never written. */
interface IdentityBackupV1 {
  type: "gryt-local-identity-backup";
  version: 1;
  exportedAt: string;
  identities: { host: string; privateJwk: JsonWebKey; publicJwk: JsonWebKey }[];
}

export interface ExportResult {
  backup: IdentityBackup;
}

/**
 * Write every local identity out for safekeeping. **This file is the person.**
 * **It keeps exactly the shape it had**, so an older client can still restore it.
 */
export async function exportLocalIdentities(): Promise<ExportResult> {
  const db = await openDB();
  const identities: IdentityBackupEntry[] = [];
  let seed: string | undefined;

  try {
    // Read rather than created. A backup of a seed nothing has used yet is a file
    // that looks like a safety net and is not one.
    const bytes = await readSeed(await idbGet<StoredSeed>(db, SEED_KEY));
    if (bytes) seed = base64UrlEncode(bytes);

    const written = new Set<string>();

    // Stored keys first. Anything still on disk is there because it could not
    // be derived, so it is the only copy in existence.
    for (const scope of await listLocalIdentityScopes(db)) {
      const pair = await idbGet<StoredKeyPair>(db, `${LOCAL_PREFIX}${scope}`);
      if (!pair?.privateKey || !pair?.publicKey) continue;
      identities.push({
        scope,
        host: pair.host,
        privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
        publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
      });
      written.add(scope);
    }

    // Then everywhere the seed says this device has been. Left to throw: a backup
    // that quietly omits a server gets trusted.
    if (bytes) {
      for (const scope of listGuestScopes()) {
        if (written.has(scope)) continue;
        const pair = await deriveLocalKeyPair(bytes, scope);
        identities.push({
          scope,
          privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
          publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
        });
      }
    }
  } finally {
    db.close();
  }

  return {
    backup: {
      type: "gryt-local-identity-backup",
      version: 2,
      exportedAt: new Date().toISOString(),
      seed,
      identities,
    },
  };
}

type AnyIdentityBackup = IdentityBackup | IdentityBackupV1;

function isBackup(value: unknown): value is AnyIdentityBackup {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<AnyIdentityBackup>;
  return (
    b.type === "gryt-local-identity-backup" &&
    (b.version === 1 || b.version === 2) &&
    Array.isArray(b.identities)
  );
}

/**
 * Both versions as one shape. Version 1 filed everything under the address and
 * called that field `host`, which is what version 2 calls `scope`.
 */
function backupEntries(backup: AnyIdentityBackup): IdentityBackupEntry[] {
  if (backup.version === 2) return backup.identities;
  return backup.identities.map((e) => ({
    scope: e.host,
    host: e.host,
    privateJwk: e.privateJwk,
    publicJwk: e.publicJwk,
  }));
}

/**
 * Read a backup file into entries, or say it is not one. Shared with
 * `device-delegation.ts`; a second copy is how one rejects what the other writes.
 */
export interface ParsedIdentityBackup {
  /** Base64url, when the file carries one. */
  seed?: string;
  identities: IdentityBackupEntry[];
}

export function parseIdentityBackup(raw: string): ParsedIdentityBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file isn't a Gryt identity backup.");
  }
  if (!isBackup(parsed)) {
    throw new Error("That file isn't a Gryt identity backup.");
  }
  return {
    seed: parsed.version === 2 ? parsed.seed : undefined,
    identities: backupEntries(parsed),
  };
}

/**
 * Put saved identities back, and report which hosts were restored. Existing keys
 * for the same host are replaced, so the UI asks before importing.
 */
export async function importLocalIdentities(raw: string): Promise<string[]> {
  const { seed, identities } = parseIdentityBackup(raw);

  const db = await openDB();
  const restored: string[] = [];

  try {
    // The seed first, so every server the file did not list is derivable the
    // moment this returns rather than only after the next join.
    if (seed) {
      const bytes = base64UrlDecode(seed);
      if (bytes.length === SEED_BYTES) await writeSeed(db, bytes);
    }

    for (const entry of identities) {
      if (!entry?.scope || !entry.privateJwk || !entry.publicJwk) continue;

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

      await idbPut(db, `${LOCAL_PREFIX}${entry.scope}`, {
        privateKey,
        publicKey,
        host: entry.host,
      });
      restored.push(entry.host ?? entry.scope);
    }
  } finally {
    db.close();
  }

  // Everything, not just the entries written: a stale key here is signing as the
  // wrong person. The caller reloads too, because anything holding a key keeps it.
  cachedKeyPairs.clear();

  // Same reason as the phrase path: a restored key proves nothing while a session
  // issued to the old identity is on disk, because the challenge is never asked.
  discardServerSessions();

  // A backup naming six servers is evidence of having been a guest on six, so the
  // history learns them too. The 24-word phrase brings nothing here (GRYT-285).
  rememberGuestScopes(identities.map((e) => e.scope));

  if (restored.length === 0) {
    throw new Error("That backup contained no identities.");
  }
  return restored;
}

/**
 * This device's identity as 24 words. Creates the seed if there is not one:
 * somebody asking to back their identity up is asking for one to exist.
 */
export async function getIdentityWords(): Promise<string> {
  const db = await openDB();
  try {
    return seedToWords(await getOrCreateSeed(db));
  } finally {
    db.close();
  }
}

/**
 * Become the identity a phrase describes. Every stored key is dropped, since each
 * came from the old seed. The caller reloads — a held key signs as the old person.
 */
export async function restoreIdentityFromWords(phrase: string): Promise<void> {
  const seed = wordsToSeed(phrase);

  const db = await openDB();
  try {
    await writeSeed(db, seed);

    for (const scope of await listLocalIdentityScopes(db)) {
      await idbDelete(db, `${LOCAL_PREFIX}${scope}`);
    }
  } finally {
    db.close();
  }

  cachedKeyPairs.clear();
  discardServerSessions();
}

/**
 * Drop every server session this device holds. **A stored token skips the identity
 * challenge entirely**, so the new key is never presented (GRYT-286).
 */
function discardServerSessions(): void {
  clearAllServerTokens();
  console.log("[Identity] Dropped stored server sessions so the next join re-proves identity");
}

/**
 * Clear the account keypair, on logout or key rotation. Deliberately leaves local
 * keys alone: logging out is not a request to be forgotten everywhere.
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
