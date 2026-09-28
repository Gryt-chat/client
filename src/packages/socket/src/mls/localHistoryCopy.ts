import type { ArchiveKeyErrorCode } from "@/common";

/** What's wrong when the archive won't open. `where` is "on this device" or "in this browser". */
export function localHistoryProblemText(code: ArchiveKeyErrorCode | null, where: string): string {
  switch (code) {
    case "unseal-failed":
      return "Your keychain didn't let Gryt open its local history. Allow it when your computer asks, then try again. If it doesn't ask, quit and reopen Gryt first.";
    case "no-keychain":
      return `Your local history is locked with a keychain Gryt can't reach ${where}.`;
    case "mismatch":
      return `Your local history doesn't match the key ${where}, so it won't open.`;
    case "damaged":
      return `The key to your local history ${where} is damaged, so it won't open.`;
    default:
      return `Gryt couldn't open your local history ${where}.`;
  }
}

export const CLEAR_LOCAL_HISTORY = "Clear local history on this device";
export const CLEAR_CONFIRM_TITLE = "Clear local history on this device?";
export const CLEAR_CONFIRM_TEXT =
  "Messages this device already decrypted will be gone for good. Messages from the last 30 days that are still on the server can't be read here either, because their keys go too. After that, this device starts over with new keys. The other person's app adds it back to each conversation by itself.";
