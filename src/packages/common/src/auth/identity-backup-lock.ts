/**
 * Passphrase-locking an identity backup (GRYT-255).
 *
 * The file holds the seed and every key the seed cannot reproduce, which is to
 * say it holds the person. Before this it was written as plain JSON and then sat
 * in Downloads, unprotected, until somebody moved it somewhere safe. Locking it
 * before it leaves means the copy on disk is worth nothing on its own.
 *
 * This is for the *file*. The 24 words are not locked, because the thing you
 * paste them into is a password manager, which is already the encryption.
 */

import {
  base64Url,
  deriveWrappingKey,
  freshNonces,
  fromBase64Url,
  PBKDF2_ITERATIONS,
} from "./passphrase-crypto.ts";

export const LOCKED_BACKUP_TYPE = "gryt-local-identity-backup-locked";

interface LockedBackup {
  type: typeof LOCKED_BACKUP_TYPE;
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

/** Whether a file is locked, so the UI knows to ask for the passphrase. */
export function isLockedBackup(raw: string): boolean {
  try {
    return (JSON.parse(raw) as Partial<LockedBackup>)?.type === LOCKED_BACKUP_TYPE;
  } catch {
    return false;
  }
}

export async function lockBackup(json: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error("Choose a password for the backup file.");

  const { salt, iv } = freshNonces();

  const key = await deriveWrappingKey(passphrase, salt, PBKDF2_ITERATIONS);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(json) as Uint8Array<ArrayBuffer>,
  );

  const locked: LockedBackup = {
    type: LOCKED_BACKUP_TYPE,
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: base64Url(salt),
    iv: base64Url(iv),
    data: base64Url(new Uint8Array(data)),
  };
  return JSON.stringify(locked, null, 2);
}

export async function unlockBackup(raw: string, passphrase: string): Promise<string> {
  let parsed: LockedBackup;
  try {
    parsed = JSON.parse(raw) as LockedBackup;
  } catch {
    throw new Error("That file isn't a Gryt identity backup.");
  }
  if (parsed?.type !== LOCKED_BACKUP_TYPE) {
    throw new Error("That file isn't a locked Gryt identity backup.");
  }

  const key = await deriveWrappingKey(
    passphrase,
    fromBase64Url(parsed.salt),
    // Read from the file rather than assumed, so a backup written under a
    // different setting still opens.
    typeof parsed.iterations === "number" ? parsed.iterations : PBKDF2_ITERATIONS,
  );

  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(parsed.iv) },
      key,
      fromBase64Url(parsed.data),
    );
    return new TextDecoder().decode(plain);
  } catch {
    // AES-GCM fails the same way for a wrong password and for a damaged file,
    // and there is no way to tell them apart from here. The wrong password is
    // overwhelmingly the likely one, so it leads.
    throw new Error("Wrong password, or the backup file is damaged.");
  }
}
