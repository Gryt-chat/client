/**
 * The one-time prompt to take the password-locked copy of the message key off the account
 * (GRYT-1871): who sees it, and what dismissing it remembers.
 */
const PREFIX = "gryt_vault_removal_dismissed:";

/** Per account, so a second account on this device still gets asked. */
export function removalPromptDismissed(grytUserId: string): boolean {
  try {
    return localStorage.getItem(`${PREFIX}${grytUserId}`) === "1";
  } catch {
    // Unreadable storage asks again. The settings notice is there either way.
    return false;
  }
}

export function dismissRemovalPrompt(grytUserId: string): void {
  try {
    localStorage.setItem(`${PREFIX}${grytUserId}`, "1");
  } catch {
    // Nothing to do. The cost is being asked once more next launch.
  }
}

export interface RemovalPromptInput {
  /** The signed-in account, or null for a guest or while it is still loading. */
  grytUserId: string | null;
  keyIsHere: boolean;
  /** undefined while loading, null when the account has no copy at all. */
  vault: object | null | undefined;
}

/** Only where this device has the key, so it can show the words before the copy goes. */
export function shouldPromptRemoval({ grytUserId, keyIsHere, vault }: RemovalPromptInput): boolean {
  if (!grytUserId || !keyIsHere || !vault) return false;
  return !removalPromptDismissed(grytUserId);
}
