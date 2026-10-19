/**
 * Servers this device has been signed out of. A note to ourselves, not a security
 * boundary — it keeps a laptop signed out across a restart (GRYT-987).
 */

const KEY = "gryt.signedOutServers";

type SignedOutRecord = Record<string, string>;

/**
 * Storage throws rather than returning null in a few real places. A device that
 * cannot remember being signed out should still start.
 */
function read(): SignedOutRecord {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SignedOutRecord;
  } catch {
    return {};
  }
}

function write(record: SignedOutRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* Nothing to do about it, and failing the sign-out over it helps nobody. */
  }
}

/** Normalised the way the rest of the client keys servers: lowercase host[:port]. */
function normalise(host: string): string {
  return (host || "").trim().toLowerCase();
}

export function markSignedOut(host: string): void {
  const key = normalise(host);
  if (!key) return;
  write({ ...read(), [key]: new Date().toISOString() });
}

export function isSignedOut(host: string): boolean {
  const key = normalise(host);
  return !!key && key in read();
}

/**
 * Let this device back in. Only ever from something a person did at this machine,
 * never from an automatic retry.
 */
export function clearSignedOut(host: string): void {
  const key = normalise(host);
  if (!key) return;
  const record = read();
  if (!(key in record)) return;
  delete record[key];
  write(record);
}

/** When this device was signed out of that server, or null. */
export function signedOutAt(host: string): string | null {
  return read()[normalise(host)] ?? null;
}
