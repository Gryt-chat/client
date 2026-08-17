/**
 * Client-side ECDSA P-256 keypair management for challenge-response
 * identity authentication. The private key never leaves the client.
 */

import { getElectronAPI } from "../../../../lib/electron";
import { clearAllServerTokens } from "../utils/tokenStorage";
import {
  deriveLocalKeyPair,
  generateSeed,
  SEED_BYTES,
  seedToWords,
  wordsToSeed,
} from "./identity-seed";
import { getOriginKeyIdForHost } from "./server-pins";

const DB_NAME = "gryt_identity_keys";
const DB_VERSION = 1;
const STORE_NAME = "keys";
const KEY_ID = "identity";
const SEED_KEY = "identity-seed";
const LOCAL_PREFIX = "local:";
const SERVER_SCOPE_PREFIX = "srv:";

/**
 * Where a signing key comes from.
 *
 * `account` is the one key the Gryt CA has issued a certificate for. There is
 * exactly one, because the certificate binds one key to one account, and the
 * account `sub` is the same on every server anyway.
 *
 * `local` is a key for one server and used nowhere else. Nothing binds these
 * together as far as a server can tell, which is the point: a local identity is
 * its own key, so one key per server means two servers cannot work out they are
 * talking to the same person. They are calculated from a single seed rather
 * than each generated separately — see `identity-seed.ts` — which keeps that
 * property and makes the whole set portable at the same time.
 */
export type IdentitySource =
  | { kind: "account" }
  | { kind: "local"; host: string };

/**
 * What a local identity is filed and calculated under (GRYT-257).
 *
 * The server, not the address it currently answers on. An address changes when
 * a port is taken (GRYT-48) or a router hands out a new lease, and the client
 * already recognises the server through that — pins are filed under the key for
 * exactly this reason. Filing the identity under the address instead meant the
 * client knew it was the same server and then arrived as a stranger: new `sub`,
 * no roles, no ownership, no history, and nothing logged to say why.
 *
 * The lineage id rather than today's key, so a server rotating its key does not
 * do the same thing (GRYT-54).
 *
 * One consequence worth knowing: a server reachable at two addresses — a LAN
 * address and a tunnel, say — is one identity now, where it used to be two.
 * That is the correct answer to "am I the same person on both", and it was
 * previously no.
 *
 * Falls back to the address when the server offered no proof at all, since
 * there is then nothing better to go on. Those identities keep the old
 * behaviour, including its bug, because nothing else is available to fix it
 * with.
 */
function identityScopeFor(host: string): string {
  const origin = getOriginKeyIdForHost(host);
  return origin ? `${SERVER_SCOPE_PREFIX}${origin}` : host;
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
   * Last address this identity was used at. Display only — never a key, and
   * never what anything is looked up by.
   *
   * Since GRYT-257 the storage key names the server rather than the address, and
   * `srv:C6ylBHyqZU--…` is not something to show anybody. Absent on entries
   * written before that, where the storage key was the address and can be shown
   * as-is.
   */
  host?: string;
}

const cachedKeyPairs = new Map<string, StoredKeyPair>();

/**
 * How the seed sits in the database.
 *
 * Sealed by the OS keychain where there is one (GRYT-256), and raw where there
 * is not — the web client, and desktop on a Linux box with no keyring. Both
 * shapes are read, so a profile that gains or loses the keychain keeps working.
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
 * Read the seed back, whichever way it was written.
 *
 * A sealed seed that will not open throws rather than returning nothing. The
 * tempting alternative — treat it as missing and make a fresh one — would hand
 * somebody a brand new identity on every server they have, silently, at the
 * exact moment their real one became temporarily unreadable. Failing loudly
 * leaves the seed on disk to be recovered once the keychain is back.
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
 * The seed every local key is calculated from, made on first use.
 *
 * Kept in the same store as the keys, because it is the same kind of secret and
 * clearing site data should take it along with everything else it already
 * takes. It is not filed under `local:`, so it stays out of
 * `listLocalIdentityHosts` and out of the export that reads from it.
 *
 * Deliberately not cleared by `clearIdentityKeys`, for the reason given there:
 * signing out of an account says nothing about the servers joined without one.
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
 * Seal a seed that was written when no keychain was reachable.
 *
 * Happens on a Linux box where a keyring was installed after Gryt was, and to
 * anything restored while the bridge was unavailable. Deliberately *not* left to
 * `getOrCreateSeed`: that only runs when a key has to be worked out, so somebody
 * whose servers all have a stored key already would never reach it and would
 * keep an unsealed seed on disk indefinitely.
 *
 * Failures are swallowed. This is opportunistic hardening of something that
 * already works, and a keychain that will not seal is not a reason to refuse
 * somebody entry to a server.
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

  // A local key is calculated from the seed, so the same identity comes back on
  // any device that holds it, including for servers that device has never
  // connected to. Every local key on this device works this way — the random
  // per-server keys that came before were only ever a day old when this landed,
  // so nothing carries them forward and there is no second kind of key to
  // reason about.
  //
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
  const stored: StoredKeyPair =
    source.kind === "local"
      ? {
          // Calculated from the scope, not the address, so the two properties
          // hold together: another device with the seed derives the same key,
          // and it keeps deriving it after the server moves.
          ...(await deriveLocalKeyPair(
            await getOrCreateSeed(db),
            identityScopeFor(source.host),
          )),
          host: source.host,
        }
      : await crypto.subtle.generateKey(ALGO, false, ["sign", "verify"]);

  // Written down even though a local key could be recalculated on demand. The
  // entry is also the record that this host was actually joined, which is what
  // `listLocalIdentityHosts` reports and what decides whether an account offers
  // to carry a previous identity over. Derivation alone cannot answer that —
  // it will happily produce a key for a server nobody has ever visited.
  await idbPut(db, storageKey, stored);
  db.close();

  cachedKeyPairs.set(storageKey, stored);
  console.log(
    `[Identity] ${
      source.kind === "local" ? "Derived" : "Generated"
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

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
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

/** Every local identity on this device, by what it is filed under. */
async function listLocalIdentityScopes(db: IDBDatabase): Promise<string[]> {
  return (await idbKeys(db))
    .filter((k) => k.startsWith(LOCAL_PREFIX))
    .map((k) => k.slice(LOCAL_PREFIX.length));
}

/**
 * Whether this device already has a local identity for a server.
 *
 * Asked before an account offers to carry a previous identity over, so it has
 * to mean "was actually joined as a guest" rather than "could produce a key
 * for". Since GRYT-254 the seed can derive a key for anywhere, so the question
 * is only ever about what is stored.
 */
export async function hasLocalIdentity(host: string): Promise<boolean> {
  const db = await openDB();
  try {
    const pair = await idbGet<StoredKeyPair>(db, storageKeyFor({ kind: "local", host }));
    return Boolean(pair?.privateKey && pair?.publicKey);
  } finally {
    db.close();
  }
}

/**
 * Addresses this device holds a local identity for, for showing someone.
 *
 * Reads the stored label rather than the key it is filed under, which since
 * GRYT-257 names the server and is not meant for display. Entries written
 * before that have no label and are filed under the address, so the key itself
 * is the honest answer for them.
 */
export async function listLocalIdentityHosts(): Promise<string[]> {
  const db = await openDB();
  try {
    const scopes = await listLocalIdentityScopes(db);
    const hosts: string[] = [];
    for (const scope of scopes) {
      const pair = await idbGet<StoredKeyPair>(db, `${LOCAL_PREFIX}${scope}`);
      hosts.push(pair?.host ?? scope);
    }
    return hosts;
  } finally {
    db.close();
  }
}

export interface IdentityBackupEntry {
  /**
   * What the identity is filed under: a server lineage since GRYT-257, an
   * address before it. Restored under the same name, so a backup taken from an
   * older client keeps working and gets moved on the next join like any other
   * address-filed identity.
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
   * The seed, base64url (GRYT-255). Absent in files written before it existed,
   * and in that case the identities listed are all there is.
   *
   * Carried alongside the keys rather than instead of them: the seed reproduces
   * everything derived from it, and nothing else. Identities generated at random
   * before GRYT-254 have to travel as themselves.
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
 * Read every local identity out for safekeeping.
 *
 * This is the file that is the person. Anyone holding it can be them on every
 * server listed in it, which is why the UI that calls this says so.
 */
export async function exportLocalIdentities(): Promise<ExportResult> {
  const db = await openDB();
  const identities: IdentityBackupEntry[] = [];
  let seed: string | undefined;

  try {
    // Read rather than created. Exporting is not a reason to bring an identity
    // into existence, and a backup of a seed nothing has used yet is a file that
    // looks like a safety net and is not one.
    const bytes = await readSeed(await idbGet<StoredSeed>(db, SEED_KEY));
    if (bytes) seed = base64UrlEncode(bytes);

    // Every key here is derived and extractable by construction, so a failure
    // to read one is a bug rather than a case to report and step over. Left to
    // throw: a backup that quietly omits a server is worse than no backup,
    // because it gets trusted.
    for (const scope of await listLocalIdentityScopes(db)) {
      const pair = await idbGet<StoredKeyPair>(db, `${LOCAL_PREFIX}${scope}`);
      if (!pair?.privateKey || !pair?.publicKey) continue;
      identities.push({
        scope,
        host: pair.host,
        privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
        publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
      });
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
 * Both versions as one shape.
 *
 * Version 1 filed everything under the address and called that field `host`,
 * which is what version 2 calls `scope`. So an old backup restores under the
 * address, exactly where it came from, and the next join to that server moves
 * it like any other address-filed identity.
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
 * Read a backup file into entries, or say it is not one.
 *
 * Shared with `device-delegation.ts`, which reads the same files for a
 * different purpose. It had its own copy of this, and a second copy is how one
 * of them ends up rejecting a version the other writes.
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
 * Put saved identities back, and report which hosts were restored.
 *
 * Existing keys for the same host are replaced. That is the point — you are
 * restoring after losing them — but it does mean importing somebody else's
 * backup would hand you their identity and drop yours, so the UI asks first.
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

  // Everything, not just the entries written. Whatever is already cached was
  // read before the restore, so none of it can be trusted to be what the user
  // just asked to be using — and a stale key here is not a stale value, it is
  // signing as the wrong person.
  //
  // The caller reloads as well. This alone is not enough: anything that already
  // read a key holds it, and clearing the map cannot reach into those.
  cachedKeyPairs.clear();

  // Same reason as the phrase path (GRYT-286). A restored key proves nothing
  // while a server session issued to the old identity is still on disk, because
  // holding one means the challenge is never asked for.
  discardServerSessions();

  if (restored.length === 0) {
    throw new Error("That backup contained no identities.");
  }
  return restored;
}

/**
 * This device's identity as 24 words (GRYT-255).
 *
 * Creates the seed if there is not one yet, which is the right moment: somebody
 * asking to back their identity up is asking for one to exist.
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
 * Become the identity a phrase describes.
 *
 * Every stored key is dropped, because every stored key came from the old seed
 * and the new one will produce its own. Nothing is kept back: there is only one
 * kind of local key now, and it is always reproducible from whichever seed is
 * in place.
 *
 * The caller reloads afterwards. Clearing the cache is not enough on its own —
 * anything that already read a key still holds it, and a stale key here is not
 * a stale value, it is signing as the wrong person.
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
 * Drop every server session this device holds (GRYT-286).
 *
 * A new seed is a new identity on every server, and the keys above are only
 * half of what proves who you are. The other half is the access token each
 * server issued, which is stored per host and carries the `grytUserId` it was
 * minted for.
 *
 * That matters because a stored token skips the identity challenge entirely.
 * `reconnectServer` re-uses it and asks for `server:details` rather than
 * `server:join`, so the new key is never presented and the server keeps
 * answering as whoever this device used to be. Reloading does not help: the
 * tokens are in localStorage and outlive it, which is why restoring appeared to
 * do nothing until you left the server and joined it again. Leaving is what
 * removed them.
 *
 * Clearing them puts every server back on the join path, where the challenge is
 * answered with the key derived from the seed that was just restored.
 */
function discardServerSessions(): void {
  clearAllServerTokens();
  console.log("[Identity] Dropped stored server sessions so the next join re-proves identity");
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
