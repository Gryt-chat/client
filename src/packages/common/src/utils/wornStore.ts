/**
 * The look this account is currently wearing, kept locally.
 *
 * The servers each hold their own copy — it is per-server the same way the
 * nickname and the avatar are. This is the account-level answer, and it exists
 * for the two moments where there is no server to ask: "Sync to all", which
 * needs a single source rather than whichever server answered last, and joining
 * a server for the first time, where the look has to come from somewhere before
 * that server has ever heard of it.
 *
 * Null means no designed look: the owl the nickname draws, or an uploaded
 * picture.
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
