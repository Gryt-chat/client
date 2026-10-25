import type { HistoryProgress, PairingEndReason } from "@gryt/core";

/* What the new device says, kept out of the dialog so the check script can read it. */

const ENDED: Partial<Record<PairingEndReason, string>> = {
  cancelled_by_other: "Your other device said no, so nothing was shared. If that was a mistake, try again.",
  mismatch: "The pictures didn't match, so nothing was shared. That's the safe answer if anything looked off. Try again for four new ones.",
  timed_out: "Your other device didn't answer in time. It might be off, out of battery or offline. Try again when it's on.",
  expired: "The code ran out before it was used, so an old one can't be approved by accident. Try again for a new one.",
  tampered: "A message from the other device didn't check out, so nothing was linked.",
  wrong_account: "You got signed in as a different account from the one on your other device. Nothing was kept.",
  sign_in_failed: "Signing in didn't finish, so nothing was kept on this device.",
  newer_version: "Your other device is on a newer version of Gryt. Update this one first.",
  rate_limited: "Too many tries. Wait a while and try again.",
  relay_error: "Couldn't reach the linking service. Check your connection.",
  history_failed: "You're linked, but this device couldn't save your message history. Link again from the other device to get it.",
  access_denied: "The sign-in was turned down, so nothing was kept. Try again.",
  expired_token: "The sign-in ran out before the other device approved it, so nothing was kept. Try again.",
};

export function newDeviceEndText(reason: PairingEndReason): string {
  return ENDED[reason] ?? "Linking stopped before it finished.";
}

/** Lines about the history coming in. Empty until the other device says it's sending some. */
export function historyLines(progress: HistoryProgress | null): string[] {
  if (!progress) return [];
  const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const lines: string[] = [];
  if (!progress.complete) {
    lines.push(
      progress.total === null
        ? `Getting your message history: ${progress.messages} so far`
        : `Getting your message history: ${Math.min(progress.messages, progress.total)} of ${progress.total}`,
    );
  } else if (progress.oldest !== null && progress.messages > 0) {
    lines.push(
      progress.truncated
        ? `The oldest messages didn't fit, so your history starts on ${date(progress.oldest)}.`
        : `Your message history goes back to ${date(progress.oldest)}.`,
    );
  }
  const lost = progress.missing + progress.refused;
  if (lost > 0) lines.push(`${lost} ${lost === 1 ? "batch" : "batches"} of messages couldn't be downloaded.`);
  return lines;
}
