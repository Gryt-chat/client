/**
 * The look this account is currently wearing, kept locally. The account-level
 * answer, for the two moments where there is no server to ask.
 */

const KEY = "avatarWorn";

/** The look, or null if there is not one. */
export function getStoredWorn(): string | null {
  try {
    const value = localStorage.getItem(KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    // Unreadable storage costs the look and nothing else — the avatar still
    // draws, from the seed or from the uploaded picture.
    return null;
  }
}

/** Record the look, or clear it when going back to a picture. */
export function setStoredWorn(worn: string | null): void {
  try {
    if (worn) localStorage.setItem(KEY, worn);
    else localStorage.removeItem(KEY);
  } catch {
    /* see above */
  }
}
