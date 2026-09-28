import { base64Url, base64UrlDecode } from "@gryt/crypto";

/**
 * The key the local archive encrypts records with, sealed by the OS keychain the
 * way the identity seed is. With no keychain there is no key and records stay plain.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;
const AAD_PREFIX = "gryt-archive-v1:";

const CHECK_CONTEXT = "key-check";
const CHECK_TEXT = "gryt-archive-key-check";

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
  /**
   * One transaction, so a key claimed by another window never shows up as a lone check.
   * `lookForSealed` also asks whether any sealed record exists, which scans until one does.
   */
  read(options?: { lookForSealed?: boolean }): Promise<{
    key: unknown;
    check: SealedBytes | undefined;
    sealedRecords: boolean;
  }>;
  claim(value: StoredArchiveKey): Promise<void>;
  /** A value sealed with the key, so a key that doesn't belong to this archive is caught. */
  writeCheck(check: SealedBytes): Promise<void>;
  /** Deletes every record, the MLS state, the key and the check. */
  wipe(): Promise<void>;
}

export interface SealedBytes {
  iv: Uint8Array;
  ct: Uint8Array;
}

export interface LoadedArchiveKey {
  /** Null keeps records in the clear: the web client, or Electron with no keyring. */
  key: CryptoKey | null;
  /** Sealed history was here with its key gone from storage, so it was cleared. */
  lostHistory: boolean;
}

/**
 * The archive is there and nothing was deleted, but it can't be opened. Every code is
 * one where the UI can offer to clear local history as something the person chooses.
 */
export type ArchiveKeyErrorCode = "unseal-failed" | "no-keychain" | "mismatch" | "damaged";

export class ArchiveKeyError extends Error {
  readonly code: ArchiveKeyErrorCode;

  constructor(code: ArchiveKeyErrorCode, message: string) {
    super(message);
    this.name = "ArchiveKeyError";
    this.code = code;
  }
}

const damaged = () => new ArchiveKeyError("damaged", "Your message history key is damaged. Nothing was deleted.");

function isStoredKey(value: unknown): value is StoredArchiveKey {
  return typeof value === "object" && value !== null && typeof (value as StoredArchiveKey).sealed === "string";
}

/** Null when the keychain can't open it. A key that opens to the wrong length throws. */
async function unsealKey(stored: StoredArchiveKey, keychain: Keychain): Promise<CryptoKey | null> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = base64UrlDecode(await keychain.unseal(stored.sealed));
  } catch {
    return null;
  }
  if (raw.length !== KEY_BYTES) throw damaged();
  try {
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    raw.fill(0);
  }
}

async function checkKey(slot: ArchiveKeySlot, key: CryptoKey): Promise<void> {
  const { check } = await slot.read();
  if (!check) {
    await slot.writeCheck(await sealBytes(key, CHECK_CONTEXT, new TextEncoder().encode(CHECK_TEXT)));
    return;
  }
  let text = "";
  try {
    text = new TextDecoder().decode(await openBytes(key, CHECK_CONTEXT, check));
  } catch {
    // Falls through to the throw below.
  }
  if (text !== CHECK_TEXT) {
    throw new ArchiveKeyError(
      "mismatch",
      "Your message history doesn't match this computer's key, so it can't be opened. Nothing was deleted.",
    );
  }
}

/**
 * The archive key, made on first use when a keychain can seal it. Only a key that's gone
 * from storage clears sealed history; a key that's there and won't open always throws.
 */
export async function loadArchiveKey(slot: ArchiveKeySlot, keychain: Keychain | null): Promise<LoadedArchiveKey> {
  const { key: stored, check, sealedRecords } = await slot.read({ lookForSealed: !!keychain?.canSeal });

  if (isStoredKey(stored)) {
    if (!keychain) {
      throw new ArchiveKeyError(
        "no-keychain",
        "Your message history was locked to this computer's keychain and can't be opened here. Nothing was deleted.",
      );
    }
    // Deny on the macOS prompt, a locked keyring and a reset keychain all land here. None of them wipes.
    const key = await unsealKey(stored, keychain);
    if (!key) throw unsealFailed();
    await checkKey(slot, key);
    return { key, lostHistory: false };
  }
  if (stored !== undefined) throw damaged();

  const lostHistory = check !== undefined || sealedRecords;
  if (lostHistory) await slot.wipe();
  if (!keychain?.canSeal) return { key: null, lostHistory };

  const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const fresh: StoredArchiveKey = { sealed: await keychain.seal(base64Url(raw)) };
  raw.fill(0);

  // Another window may have claimed the slot first, and then its key is the one records use.
  await slot.claim(fresh);
  const winner = (await slot.read()).key;
  if (!isStoredKey(winner)) throw new Error("Your message history key couldn't be saved.");
  const key = await unsealKey(winner, keychain);
  if (!key) throw unsealFailed();
  await checkKey(slot, key);
  return { key, lostHistory };
}

function unsealFailed(): ArchiveKeyError {
  return new ArchiveKeyError(
    "unseal-failed",
    "This computer's keychain wouldn't unlock your message history. Nothing was deleted.",
  );
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
