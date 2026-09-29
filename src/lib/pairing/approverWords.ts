import type { HistoryProgress, PairingEndReason } from "@gryt/core";

/* What the approving side says, kept out of the dialog so the check script can read it. */

const ENDED: Partial<Record<PairingEndReason, string>> = {
  cancelled: "Nothing was linked.",
  cancelled_by_other: "It was cancelled on the new device.",
  mismatch: "You said the emoji didn't match, so nothing was sent. Someone may have been in the middle of the connection.",
  timed_out: "It wasn't approved in time, so nothing was sent.",
  expired: "That code ran out. The new device shows a fresh one.",
  already_claimed: "Somebody else already entered this code. If that wasn't you, cancel on the new device.",
  unknown_code: "No device is showing that code. Check it, or wait for the new device to show a fresh one.",
  wrong_relay: "That code is for a different linking service from the one this device uses.",
  not_pairing: "That isn't a Gryt linking code.",
  newer_version: "The new device is on a newer version of Gryt. Update this one first.",
  tampered: "A message from the new device didn't check out, so nothing was sent.",
  rate_limited: "Too many tries. Wait a while and try again.",
  relay_error: "Couldn't reach the linking service. Check your connection.",
  code_used: "That sign-in was already answered. Start again from the new device.",
  code_expired: "The new device's sign-in ran out before you approved it. Start again from the new device.",
  required_actions:
    "Your account has something to finish first, like verifying your email. Do that in your account settings, then try again.",
  stale_token: "This device's sign-in is too old to approve with. Sign in again, then try again.",
  access_denied: "The sign-in service turned the new device down. Start again from the new device.",
  expired_token: "The new device's sign-in ran out before you approved it. Start again from the new device.",
  "approve:network": "Couldn't reach the sign-in server to approve the new device.",
  "approve:user_locked": "Your account is locked for now after too many sign-in attempts.",
};

export function approverEndText(reason: PairingEndReason): string {
  const known = ENDED[reason];
  if (known) return known;
  if (reason.startsWith("approve:")) {
    return `The sign-in service turned this down (${reason.slice("approve:".length)}). Start again from the new device.`;
  }
  return "Linking stopped before it finished.";
}

/** While the history goes across, after the new device is in every conversation. */
export function sendingHistoryText(progress: HistoryProgress | null): string {
  if (!progress) return "Sending your message history…";
  if (progress.total === null) return `Sending your message history: ${progress.messages} so far`;
  return `Sending your message history: ${Math.min(progress.messages, progress.total)} of ${progress.total}`;
}

/** Null when no history went, so the done screen says nothing about it. */
export function sentHistoryText(progress: HistoryProgress | null): string | null {
  if (!progress || progress.messages === 0) return null;
  return `${progress.messages} ${progress.messages === 1 ? "message" : "messages"} of history came across.`;
}
