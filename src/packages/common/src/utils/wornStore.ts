/**
 * The look this account is currently wearing, kept locally.
 *
 * The servers each hold their own copy — it is per-server the same way the
 * nickname and the avatar are, so somebody can be a pirate in one place and
 * plain everywhere else. This is the account-level answer, and it exists for
 * the two moments where there is no server to ask:
 *
 *   - "Sync to all", which pushes one profile to every connected server and so
 *     needs a single source rather than whichever server answered last.
 *   - Joining a server for the first time, where the look has to come from
 *     somewhere before that server has ever heard of it.
 *
 * localStorage rather than the IndexedDB store beside it, because this is
 * sixteen characters and that one holds an image. It sits next to the wardrobe,
 * which is the same kind of data and already lives there.
 *
 * Null means no designed look: the owl the nickname draws, or an uploaded
 * picture. Clearing it is a real action — going back to a photograph — and not
 * the same as never having set one, though both read as null here, because
 * nothing needs to tell them apart.
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
