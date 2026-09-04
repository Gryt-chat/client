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
 * Where a signing key comes from. `account` is the one key the Gryt CA has
 * certified; there is exactly one, since the account `sub` is the same on every
 * server anyway.
 *
 * `local` is a key for one server and used nowhere else. **Nothing binds them
 * together as far as a server can tell** — that is the point, and it is what
 * one key per server buys. They are derived from a single seed rather than
 * generated separately, which keeps the property and makes the set portable.
 */
export type IdentitySource =
  | { kind: "account" }
  | { kind: "local"; host: string };

/**
 * What a local identity is filed and derived under (GRYT-257).
 *
 * **The server, not the address it currently answers on.** An address changes
 * when a port is taken or a lease moves, and filing under it meant the client
 * recognised the server and then arrived as a stranger — new `sub`, no roles,
 * no ownership, nothing logged.
 *
 * The lineage id rather than today's key, so a rotation does not do the same
 * thing (GRYT-54). A server reachable at two addresses is therefore one
 * identity, which is the correct answer.
 *
 * Falls back to the address for a server that offered no proof, which keeps the
 * old behaviour and its bug because nothing better is available.
 */
/*
 * Re-exported here because this is where a consumer looks for them —
 * `identityScopeFor` lives in this file and `identity-seed.ts` is not in the
 * `@/common` barrel. The type is declared over there so `dm-keys.ts` can use it
 * without importing the module that owns the database.
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
 * the guest history and out of the export that reads from it.
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

  // A local key is derived from the seed, so the same identity comes back on
  // any device holding it, including for servers that device never connected to.
  //
  // **Local keys are extractable so they can be saved and restored**; the
  // account key is not and does not need to be, since the CA will certify a
  // fresh one. The trade is smaller than it sounds: a non-extractable key can
  // still be *used* to sign by anything in this page, so extractability decides
  // whether a compromise outlives the page rather than whether one is possible.
  // Without it, clearing site data destroys every server this identity was
  // known on, permanently and silently.
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

  // A derived key is not written down (GRYT-285). It is reproducible from the
  // seed and the scope, so storing it puts a second copy of a private key on
  // disk to save work that takes a millisecond, and the seed has to be kept
  // safe either way. The in-memory cache below is the only copy this session
  // needs.
  //
  // The account key is different and is still stored: it is generated at
  // random, non-extractable, and nothing can reproduce it.
  //
  // The record of having been somewhere moves to the guest history, which is
  // the reason it exists. It is written before the cache so a caller that
  // derives and immediately asks `hasLocalIdentity` sees a consistent answer.
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
 * The same signature, over a key the caller already holds.
 *
 * Split out for the one thing `signJwt` cannot do: sign with a key that is not
 * one of this device's identities, and put the public half in the protected
 * header so a verifier that has never seen the key can check it — `jwk`, which
 * is what `jose`'s `EmbeddedJWK` reads. A server join has no use for it,
 * because the certificate carries the key separately.
 *
 * `alg` and `typ` are applied after `extraHeader`, so a caller cannot quietly
 * downgrade the algorithm by passing one.
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
 * A key from this device's seed for something that is not a Gryt server — the
 * report service. Signing with a per-server guest key would tell that service
 * which server the reporter uses, which is the disclosure the one-key-per-server
 * design exists to avoid.
 *
 * **`scope` shares a namespace with `identityScopeFor`, which prefixes servers
 * with `srv:`.** Anything passed here has to stay clear of that prefix.
 *
 * Not stored or cached, since it is reproducible from the seed. It does create
 * the seed if there is not one, as joining anywhere would.
 */
/**
 * The binding this device would publish for one server (GRYT-727). Assembled
 * here because it needs two things that never leave this module: the seed and
 * the identity private key.
 *
 * **`source` has to be the identity this device actually joined with.** The DM
 * key does not depend on it; the signature does, and the value of the binding
 * is that the signing key is the one the server challenged on the way in.
 *
 * Null for a device that has not joined anything. Not an error.
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
   * server** (GRYT-759). An account key is `crypto.subtle.generateKey` — random
   * and different on every device — so two devices signed into one account
   * published two bindings for the same DM key and every peer watched the
   * thumbprint flip. That is indistinguishable from a server substituting a
   * key, so the client correctly refused to encrypt.
   *
   * Nothing is weakened. A binding is trust on first use, and nothing ties it
   * to the identity the server knows you by — what a peer pins is the
   * thumbprint that keeps arriving, which is what the seed buys.
   *
   * Mobile has signed with this derivation since GRYT-732, so it also makes the
   * two platforms agree.
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
 * The DM public key this device uses on one server, for checking your own row.
 *
 * You know what your key here should be, so a member list showing something
 * else under your own id is this server rewriting it (GRYT-727). That is the
 * one check a single person can run with nobody else involved.
 */
/**
 * This device's DM keypair for one server, private half included (GRYT-729).
 * X25519 is not in WebCrypto, so there is no non-extractable handle to pass
 * instead of the bytes.
 *
 * **This is the one accessor that hands out key material.** It goes to
 * `sealMessage` and `openMessage` and nowhere else: never sent, never stored
 * anywhere but the seed it came from, never logged. **The seed itself stays in
 * this module** — that is the difference between handing out one server's key
 * and handing out every key this person will ever have.
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
 * This device's own half of a comparison code, for one server (GRYT-730).
 *
 * Both people's keys go into the code, so a card cannot draw one without
 * knowing what we published here. The thumbprint is of the identity key that
 * joined — the same one that signs the binding other people verify — so the two
 * sides are made of the same four things.
 *
 * Public halves only. Nothing here is secret and the code is meant to be read
 * out loud.
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
 * Whether this device already has a local identity for a server.
 *
 * Asked before an account offers to carry a previous identity over, so it has
 * to mean "was actually joined as a guest" rather than "could produce a key
 * for". Since GRYT-254 the seed can derive a key for anywhere, so the question
 * is only ever about what is stored.
 */
export async function hasLocalIdentity(host: string): Promise<boolean> {
  const scope = identityScopeFor(host);
  if (hasGuestScope(scope)) return true;

  // Falls back to the stored key for anyone who has not been through the
  // backfill yet, so an upgrade cannot lose somebody the offer to carry an
  // identity over between one release and the next.
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
 * Teach the guest history what the stored keys already know (GRYT-285).
 *
 * One pass, on an install that predates the history. Every `local:*` entry is
 * evidence of having been a guest somewhere, so the scopes move across and the
 * keys stop being the only thing that remembers.
 *
 * Reads rather than derives, deliberately: the point is what was used, and
 * derivation cannot tell that apart from what could be used.
 */
/**
 * Delete stored local keys the seed can reproduce (GRYT-285) — a second copy of
 * a private key kept to save a millisecond of arithmetic.
 *
 * **Each is checked rather than assumed.** A key is removed only when the seed
 * reproduces the same public coordinates. Anything that does not match is left
 * alone: on a device that joined before the seed existed those keys are random
 * and the only copy, so deleting one takes the membership with it.
 *
 * Runs after `backfillGuestHistory`, which preserves the record of having been
 * on those servers once the keys are gone.
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
 * Write every local identity out for safekeeping. **This file is the person** —
 * anyone holding it can be them on every server in it, which is why the UI that
 * calls this says so.
 *
 * **The file keeps exactly the shape it had**: a seed plus one entry per
 * server. A backup written today still restores on a client from before
 * GRYT-285, which is not a property to give up on the file people reach for
 * after losing everything.
 *
 * Two sources: the guest history names servers whose keys come from the seed,
 * and a stored `local:*` entry is a key that predates the seed, cannot be
 * reproduced, and takes precedence.
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

    // Then everywhere the seed says this device has been. Left to throw rather
    // than skipped: a backup that quietly omits a server is worse than no
    // backup at all, because it gets trusted.
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

  // A backup naming six servers is evidence of having been a guest on six
  // servers, so the history learns them too (GRYT-285). The 24-word phrase
  // brings nothing here, because a seed knows only how to derive keys and
  // nothing about where they were used.
  rememberGuestScopes(identities.map((e) => e.scope));

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
 * Drop every server session this device holds (GRYT-286). A new seed is a new
 * identity, and the keys are only half of what proves who you are — the other
 * half is each server's access token, which carries the `grytUserId` it was
 * minted for.
 *
 * **A stored token skips the identity challenge entirely**, so the new key is
 * never presented and the server keeps answering as whoever this device used to
 * be. The tokens outlive a reload, which is why restoring appeared to do
 * nothing until you left the server and joined again.
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
