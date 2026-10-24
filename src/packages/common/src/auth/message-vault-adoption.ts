/**
 * Whether to offer this device the account's message key. A stored marker, because
 * opening the sealed copy needs the secret being asked for (GRYT-783).
 */

const PREFIX = "gryt_message_key_here:";

/** Keyed per account, so two accounts on one device do not answer for each other. */
function markerKey(grytUserId: string): string {
  return `${PREFIX}${grytUserId}`;
}

export function hasMessageKeyHere(grytUserId: string): boolean {
  try {
    return localStorage.getItem(markerKey(grytUserId)) === "1";
  } catch {
    // No storage means no marker, which offers the prompt. See above: that is
    // the direction to fail in.
    return false;
  }
}

export function rememberMessageKeyHere(grytUserId: string): void {
  try {
    localStorage.setItem(markerKey(grytUserId), "1");
  } catch {
    // Nothing to do. The cost is being offered the prompt again.
  }
}
