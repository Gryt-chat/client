import { base64Url, base64UrlDecode } from "@gryt/crypto";

/**
 * The key the local archive encrypts records with, sealed by the OS keychain the
 * way the identity seed is. With no keychain there is no key and records stay plain.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;
const AAD_PREFIX = "gryt-archive-v1:";

/** The OS keychain bridge. `canSeal` is false on a Linux box with no keyring. */
export interface Keychain {
  canSeal: boolean;
  seal(plain: string): Promise<string>;
  unseal(sealed: string): Promise<string>;
}

export interface StoredArchiveKey {
  sealed: string;
}

/** Where the sealed key is kept. `claim` writes only if nothing is there yet. */
export interface ArchiveKeySlot {
  read(): Promise<unknown>;
  claim(value: StoredArchiveKey): Promise<void>;
}

export interface SealedBytes {
  iv: Uint8Array;
  ct: Uint8Array;
}

function isStoredKey(value: unknown): value is StoredArchiveKey {
  return typeof value === "object" && value !== null && typeof (value as StoredArchiveKey).sealed === "string";
}

async function unsealKey(stored: StoredArchiveKey, keychain: Keychain | null): Promise<CryptoKey> {
  // Throws rather than returning null: a fresh key would orphan every record already written.
  if (!keychain) {
    throw new Error("Your message history was locked to this computer's keychain and can't be opened here.");
  }
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = base64UrlDecode(await keychain.unseal(stored.sealed));
  } catch {
    throw new Error("Your message history couldn't be unlocked. The keychain may have been reset.");
  }
  if (raw.length !== KEY_BYTES) throw new Error("Your message history key is damaged.");
  try {
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    raw.fill(0);
  }
}

/**
 * The archive key, made on first use when a keychain can seal it. Null means this
 * archive keeps records in the clear: the web client, or Electron with no keyring.
 */
export async function loadArchiveKey(slot: ArchiveKeySlot, keychain: Keychain | null): Promise<CryptoKey | null> {
  const stored = await slot.read();
  if (isStoredKey(stored)) return unsealKey(stored, keychain);
  if (stored !== undefined) throw new Error("Your message history key is damaged.");
  if (!keychain?.canSeal) return null;

  const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const fresh: StoredArchiveKey = { sealed: await keychain.seal(base64Url(raw)) };
  raw.fill(0);

  // Another window may have claimed the slot first, and then its key is the one records use.
  await slot.claim(fresh);
  const winner = await slot.read();
  if (!isStoredKey(winner)) throw new Error("Your message history key couldn't be saved.");
  return unsealKey(winner, keychain);
}

function aad(context: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(AAD_PREFIX + context);
}

/** `context` names the record, so a sealed value moved under another name fails to open. */
export async function sealBytes(key: CryptoKey, context: string, plain: Uint8Array): Promise<SealedBytes> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(context) },
    key,
    plain as Uint8Array<ArrayBuffer>,
  );
  return { iv, ct: new Uint8Array(ct) };
}

export async function openBytes(key: CryptoKey, context: string, sealed: SealedBytes): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv as Uint8Array<ArrayBuffer>, additionalData: aad(context) },
    key,
    sealed.ct as Uint8Array<ArrayBuffer>,
  );
  return new Uint8Array(plain);
}
