/**
 * Whether to offer this device the account's message key (GRYT-783).
 *
 * The decision is separated from everything that performs it, and has no
 * imports, so it can be checked without a browser.
 *
 * ## Why a stored marker rather than a comparison
 *
 * The honest question is "does this device already hold the key the account
 * sealed", and it cannot be answered directly: the sealed copy can only be
 * opened with the secret, and asking for the secret is the very thing being
 * decided. So the device records that it has the key — set both when it seals
 * one (it was the source) and when it adopts one.
 *
 * The failure mode is deliberately the safe direction. A missing marker offers
 * a prompt to somebody who did not need it, which costs a dismissal. A marker
 * that wrongly claimed the key is here would hide the offer from the one person
 * who needed it, and they would go on writing messages their other devices
 * cannot read without ever being told why.
 *
 * Clearing site data therefore re-offers, which is correct: clearing site data
 * really does remove the key.
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
 * Offer the prompt, or say nothing.
 *
 * Nothing is said while the answer is still being fetched. A prompt that
 * appears and then vanishes reads as a glitch, and this one is asking for a
 * password — the last thing that should flicker.
 */
export function shouldOfferMessageKey({
  signedIn,
  vaultExists,
  keyIsHere,
}: MessageKeyOfferInput): boolean {
  if (!signedIn) return false;
  if (vaultExists !== true) return false;
  return !keyIsHere;
}
