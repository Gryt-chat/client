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

export function forgetMessageKeyHere(grytUserId: string): void {
  try {
    localStorage.removeItem(markerKey(grytUserId));
  } catch {
    /* as above */
  }
}

export interface MessageKeyOfferInput {
  /** Guests are not offered this: they have the 24 words already. */
  signedIn: boolean;
  /** Whether the account has a sealed copy at all. `null` while still loading. */
  vaultExists: boolean | null;
  /** Whether this device has recorded holding the key. */
  keyIsHere: boolean;
}

/**
 * "adopt" takes the account's copy onto this device. "protect" makes one, on an
 * account that has none and is one sign-in away from breaking (GRYT-1130).
 */
export type MessageKeyOffer = "adopt" | "protect" | null;

/**
 * Which offer to make, or none. None while the answer is still being fetched:
 * both of these ask for a password, and neither must flicker.
 */
export function shouldOfferMessageKey({
  signedIn,
  vaultExists,
  keyIsHere,
}: MessageKeyOfferInput): MessageKeyOffer {
  if (!signedIn) return null;
  if (vaultExists === null) return null;

  /* No sealed copy anywhere. The next device to sign in makes its own key, and
     everyone who pinned this one stops encrypting to it (GRYT-1117). */
  if (!vaultExists) return "protect";

  return keyIsHere ? null : "adopt";
}
