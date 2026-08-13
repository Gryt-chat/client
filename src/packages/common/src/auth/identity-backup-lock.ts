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

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

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

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
}

/**
 * PBKDF2 rather than Argon2, which would resist a cracking rig better.
 *
 * The trade bought is a dependency: PBKDF2 is in WebCrypto already, and this
 * ships in a client where the alternative is another package on the critical
 * path of somebody's identity. 600k iterations of SHA-256 is the current OWASP
 * figure, and the file is one a user chose to protect rather than one an
 * attacker is expected to hold. `iterations` is recorded in the file so raising
 * it later does not strand backups written today.
 */
async function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase) as Uint8Array<ArrayBuffer>,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
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

  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);

  const key = await deriveWrappingKey(passphrase, salt as Uint8Array<ArrayBuffer>, PBKDF2_ITERATIONS);
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
