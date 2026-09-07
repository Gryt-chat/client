/**
 * Servers this device has been signed out of, and has not been let back into.
 *
 * Signing out your other devices works while they are running: they get
 * `token:revoked`, drop both tokens, and refuse to rejoin. That refusal lived
 * in React state, so restarting the app undid it. The client still holds the
 * keypair and is still a member, and the server cannot tell that join apart
 * from any other -- so the device signed itself back in on the next launch, and
 * the person who signed it out was never told. GRYT-987.
 *
 * This is a note to ourselves, not a security boundary. Anybody who controls
 * the machine can clear it, and a client that ignored it entirely would still
 * be let in. What it buys is that the ordinary case -- somebody signs a laptop
 * out from their phone -- stays signed out until a person at that laptop says
 * otherwise. Ending it on the server needs a device identity, which is the
 * device-list work still open on GRYT-973.
 */

const KEY = "gryt.signedOutServers";

type SignedOutRecord = Record<string, string>;

/**
 * Storage throws rather than returning null in a few real places -- a private
 * window, a browser set to block site data, a thumbnail render. A device that
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
 * Let this device back in.
 *
 * Only ever from something a person did at this machine -- pressing the button
 * on the card, reconnecting, or adding the server again. Never from an
 * automatic retry, which is the whole point.
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
