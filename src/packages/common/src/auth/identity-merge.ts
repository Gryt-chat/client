/**
 * Whether an account may take over the identities this device joined servers
 * with before it signed in.
 *
 * The server will carry a membership across whenever the client proves it holds
 * the old key (GRYT-170). That is the right default on your own machine and the
 * wrong one on a borrowed laptop, where the guest identity belongs to whoever
 * used it last and signing in would quietly inherit their servers along with
 * anything they own.
 *
 * So the proof is only offered once somebody has said yes. Unset means
 * unanswered, and unanswered means no.
 */

const MERGE_CHOICE_KEY = "gryt_merge_local_identities";

export type MergeChoice = "unanswered" | "yes" | "no";

export function getMergeChoice(): MergeChoice {
  try {
    const raw = localStorage.getItem(MERGE_CHOICE_KEY);
    return raw === "yes" || raw === "no" ? raw : "unanswered";
  } catch {
    return "unanswered";
  }
}

export function setMergeChoice(choice: "yes" | "no"): void {
  try {
    localStorage.setItem(MERGE_CHOICE_KEY, choice);
  } catch {
    // localStorage not available
  }
}

/**
 * Forgotten on sign-out, so the next account is asked for itself rather than
 * inheriting a yes that was meant for a different one.
 */
export function clearMergeChoice(): void {
  try {
    localStorage.removeItem(MERGE_CHOICE_KEY);
  } catch {
    // localStorage not available
  }
}
